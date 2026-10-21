using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using GsPlan.Core.Axis;
using GsPlan.Core.Stats;

namespace GsPlan.Core.Gcsim;

public sealed class GcsimImportInput
{
    public required JsonElement Sample { get; init; }
    public required JsonElement Mapping { get; init; }
    public required GcsimCatalogues Catalogues { get; init; }
    public required IReadOnlyDictionary<string, JsonElement> CharacterData { get; init; }
    public JsonElement? TalentDamage { get; init; }
    public IReadOnlyDictionary<string, JsonElement>? SetBonuses { get; init; }
    public StatsCompact? Stats { get; init; }
}

public sealed class GcsimImportResult
{
    public required JsonObject Doc { get; init; }
    public required JsonObject Report { get; init; }
}

/// <summary>
/// C# counterpart of <c>src/lib/gcsim-import.js</c>. The ordering and the
/// coercions are deliberately kept identical: both a synthetic sample and the
/// real 5 MB export are compared against the JavaScript result.
/// </summary>
public static partial class GcsimImporter
{
    public const string ConfigKind = "lunaris-config";
    public const int ConfigVersion = 2;
    public const string FlatSourcePrefix = "flatdmg";

    public static IReadOnlyList<string> ResolveCharacterIds(
        JsonElement sample,
        JsonElement mapping,
        JsonElement characters)
    {
        var ids = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        if (GcsimSupport.Property(sample, "character_details") is not { ValueKind: JsonValueKind.Array } details)
        {
            return ids;
        }
        var mappingChars = GcsimSupport.Property(mapping, "characters");
        foreach (var detail in details.EnumerateArray())
        {
            var name = GcsimSupport.Text(GcsimSupport.Property(detail, "name"));
            string? id = null;
            if (!string.IsNullOrEmpty(name)
                && mappingChars is { ValueKind: JsonValueKind.Object } map
                && map.TryGetProperty(name, out var mapped)
                && GcsimSupport.Truthy(mapped))
            {
                id = GcsimSupport.StringValue(mapped);
            }
            id ??= GcsimSupport.ResolveByName(name, characters);
            if (id is not null && seen.Add(id)) ids.Add(id);
        }
        return ids;
    }

    public static IReadOnlyList<string> ResolveSetIds(
        JsonElement sample,
        JsonElement mapping,
        JsonElement artifacts)
    {
        var ids = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        if (GcsimSupport.Property(sample, "character_details") is not { ValueKind: JsonValueKind.Array } details)
        {
            return ids;
        }
        var overrides = GcsimSupport.Property(mapping, "sets");
        foreach (var detail in details.EnumerateArray())
        {
            if (GcsimSupport.Property(detail, "sets") is not { ValueKind: JsonValueKind.Object } sets) continue;
            foreach (var property in sets.EnumerateObject())
            {
                var id = GcsimSupport.ResolveByName(property.Name, artifacts, overrides);
                if (id is not null && seen.Add(id)) ids.Add(id);
            }
        }
        return ids;
    }

    public static GcsimImportResult Import(GcsimImportInput input)
        => new Run(input).Execute();

    private sealed class CharacterRef
    {
        public int Index { get; init; }
        public required string Id { get; init; }
        public required JsonElement Detail { get; init; }
        public string? Name { get; init; }
    }

    private sealed class UnitBuild
    {
        public required string CharId { get; init; }
        public required JsonElement Detail { get; init; }
        public double Level { get; init; }
        public string? WeaponId { get; init; }
        public required Dictionary<string, ArtifactPiece> Artifacts { get; init; }
    }

    private sealed class TeamBuild
    {
        public required JsonObject Team { get; init; }
        public required List<UnitBuild> Units { get; init; }
    }

    private sealed class HitBuff
    {
        public required string Source { get; init; }
        public required string Key { get; init; }
        public double Value { get; set; }
    }

    private sealed class Hit
    {
        public double? Talent { get; init; }
        public bool Crit { get; init; }
        public string? Ele { get; init; }
        public List<HitBuff> Buffs { get; } = [];
        public Dictionary<string, HitBuff> BuffIndex { get; } = new(StringComparer.Ordinal);

        public void AddBuff(HitBuff buff, string id)
        {
            BuffIndex[id] = buff;
            Buffs.Add(buff);
        }
    }

    private sealed class DamageEvent
    {
        public int Index { get; init; }
        public int CharIndex { get; init; }
        public double Frame { get; init; }
        public required JsonElement Logs { get; init; }
        public bool HasSourceFrame { get; init; }
        public string? SourceFrameKey { get; init; }
        public string? Ability { get; init; }
        public string? Ele { get; init; }
        public JsonElement? Calc { get; set; }
    }

    private sealed class Cast
    {
        public int CharIndex { get; init; }
        public string? Ability { get; init; }
        public double Hits { get; set; }
        public double Total { get; set; }
        public bool CritAll { get; set; } = true;
        public bool CritNone { get; set; } = true;
        public string? Ele { get; init; }
        public List<Hit> Events { get; } = [];
    }

    private sealed class AbilityReport
    {
        public required string Char { get; init; }
        public required string Ability { get; init; }
        public double Hits { get; set; }
        public bool Mapped { get; set; }
        public bool Ignored { get; init; }
        public bool Stale { get; set; }
    }

    private sealed class CardReport
    {
        public required string LibKey { get; init; }
        public required string Kind { get; init; }
        public JsonNode? Name { get; init; }
        public int Rows { get; set; }
        public double Hits { get; set; }
    }

    private sealed class NoteBag
    {
        public List<JsonObject> Notes { get; } = [];
        private readonly HashSet<string> _seen = new(StringComparer.Ordinal);
        public void Add(JsonObject note)
        {
            if (_seen.Add(note.ToJsonString())) Notes.Add(note);
        }
    }

    private sealed class Pick
    {
        public required string Source { get; init; }
        public double Pred { get; init; }
    }

    private sealed class Choice
    {
        public double Error { get; init; }
        public required List<Pick> Picks { get; init; }
    }

    private sealed partial class Run
    {
        private readonly GcsimImportInput _input;
        private readonly JsonElement _sample;
        private readonly JsonElement _mapping;
        private readonly GcsimCatalogues _catalogues;
        private readonly IReadOnlyDictionary<string, JsonElement> _charData;
        private readonly JsonElement _abilities;
        private readonly JsonElement _ignored;
        private readonly JsonElement _buffTable;
        private readonly JsonElement _extraSources;
        private readonly JsonElement _teamAbilities;
        private readonly JsonElement _flatRules;
        private readonly JsonElement _ignoreDefRules;
        private readonly JsonElement? _enemyLevel;
        private readonly List<CharacterRef> _details = [];
        private readonly List<DamageSource>[] _sources;
        private Dictionary<string, JsonObject> _sourcesByKey = new(StringComparer.Ordinal);
        private readonly Dictionary<string, Dictionary<string, double>> _panels = new(StringComparer.Ordinal);
        private readonly List<JsonObject> _statNotes = [];
        private readonly NoteBag _buffNotes = new();
        private readonly List<CardReport> _cards = [];
        private readonly Dictionary<string, CardReport> _cardByKey = new(StringComparer.Ordinal);
        private readonly JsonArray _entries = [];
        private readonly List<AbilityReport> _byAbility = [];
        private readonly Dictionary<string, AbilityReport> _abilityByKey = new(StringComparer.Ordinal);
        private readonly List<DamageEvent> _damage = [];
        private readonly Dictionary<int, JsonElement> _calcByDamage = [];
        private readonly Dictionary<int, List<(double Frame, double Flat)>> _observedFlat = [];
        private readonly Dictionary<int, List<(double Frame, double Atk)>> _scalingTimeline = [];
        private readonly Dictionary<string, int> _indexById = new(StringComparer.Ordinal);
        private int _sequence;

        public Run(GcsimImportInput input)
        {
            _input = input;
            _sample = input.Sample;
            _mapping = input.Mapping;
            _catalogues = input.Catalogues;
            _charData = input.CharacterData;
            _abilities = GcsimSupport.Property(_mapping, "abilities") ?? default;
            _ignored = GcsimSupport.Property(_mapping, "ignored") ?? default;
            _buffTable = GcsimSupport.Property(_mapping, "buffs") ?? default;
            _extraSources = GcsimSupport.Property(_mapping, "extraSources") ?? default;
            _teamAbilities = GcsimSupport.Property(_mapping, "teamAbilities") ?? default;
            var calc = GcsimSupport.Property(_mapping, "calc") ?? default;
            _flatRules = GcsimSupport.Property(calc, "flatDmg") ?? default;
            _ignoreDefRules = GcsimSupport.Property(calc, "ignoreDef") ?? default;

            if (GcsimSupport.Property(_sample, "character_details") is { ValueKind: JsonValueKind.Array } details)
            {
                for (var i = 0; i < details.GetArrayLength(); i++)
                {
                    var detail = details[i];
                    _details.Add(new CharacterRef
                    {
                        Index = i,
                        Id = string.Empty,
                        Detail = detail,
                        Name = GcsimSupport.Text(GcsimSupport.Property(detail, "name")),
                    });
                }
            }
            _sources = new List<DamageSource>[_details.Count];

            if (GcsimSupport.Property(_sample, "target_details") is { ValueKind: JsonValueKind.Array } targets
                && targets.GetArrayLength() > 0)
            {
                var level = GcsimSupport.Property(targets[0], "level");
                if (level is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined })
                {
                    _enemyLevel = level.Value;
                }
            }
        }

        public GcsimImportResult Execute()
        {
            ResolveCharacters();
            var team = BuildTeam();
            _sourcesByKey = GcsimSourceIndex.Build(
                team.Team,
                _catalogues,
                _charData,
                _input.SetBonuses ?? new Dictionary<string, JsonElement>(StringComparer.Ordinal));
            DerivePanels(team.Units);
            IndexLog();
            CollectTimelines();

            var castMap = new Dictionary<string, Cast>(StringComparer.Ordinal);
            var casts = new List<Cast>();
            Cast? adjacent = null;
            foreach (var damageEvent in _damage)
            {
                Cast cast;
                if (damageEvent.HasSourceFrame)
                {
                    var key = damageEvent.CharIndex + "|" + GcsimSupport.TemplateText(
                        GcsimSupport.Property(damageEvent.Logs, "abil")) + "|" + damageEvent.SourceFrameKey;
                    if (!castMap.TryGetValue(key, out cast!))
                    {
                        cast = NewCast(damageEvent);
                        castMap[key] = cast;
                        casts.Add(cast);
                    }
                }
                else if (adjacent is null
                    || adjacent.CharIndex != damageEvent.CharIndex
                    || adjacent.Ability != damageEvent.Ability)
                {
                    adjacent = NewCast(damageEvent);
                    casts.Add(adjacent);
                    cast = adjacent;
                }
                else
                {
                    cast = adjacent;
                }

                cast.Hits += 1;
                cast.Total += GcsimSupport.NumberOrZero(GcsimSupport.Property(damageEvent.Logs, "damage"));
                var crit = GcsimSupport.Truthy(GcsimSupport.Property(damageEvent.Logs, "crit"));
                cast.CritAll = cast.CritAll && crit;
                cast.CritNone = cast.CritNone && !crit;

                var calcLogs = GcsimSupport.Property(damageEvent.Calc, "logs");
                var talentRaw = GcsimSupport.Property(calcLogs, "talent");
                var talent = talentRaw is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined }
                    ? GcsimSupport.Number(talentRaw)
                    : double.NaN;
                var hit = new Hit
                {
                    Talent = double.IsFinite(talent) ? talent : null,
                    Crit = crit,
                    Ele = damageEvent.Ele,
                };
                cast.Events.Add(hit);
                AbsorbStatuses(hit, damageEvent.Logs, calcLogs, damageEvent);
            }

            foreach (var cast in casts) Flush(cast);

            var mappedHits = _byAbility.Where(row => row.Mapped).Sum(row => row.Hits);
            var ignoredHits = _byAbility.Where(row => !row.Mapped && row.Ignored).Sum(row => row.Hits);
            var rows = _byAbility
                .Select((row, index) => (row, index))
                .OrderByDescending(item => item.row.Hits)
                .ThenBy(item => item.index)
                .Select(item => item.row)
                .ToArray();
            var cards = _cards
                .Select((row, index) => (row, index))
                .OrderByDescending(item => item.row.Hits)
                .ThenBy(item => item.index)
                .Select(item => item.row)
                .ToArray();

            var report = new JsonObject
            {
                ["damageEvents"] = _damage.Count,
                ["entries"] = _entries.Count,
                ["mappedHits"] = mappedHits,
                ["ignoredHits"] = ignoredHits,
                ["unmappedHits"] = _damage.Count - mappedHits - ignoredHits,
                ["byAbility"] = new JsonArray(rows.Select(row => (JsonNode?)RowJson(row)).ToArray()),
                ["statNotes"] = new JsonArray(_statNotes.Select(note => (JsonNode?)note.DeepClone()).ToArray()),
                ["buffs"] = new JsonObject
                {
                    ["cards"] = new JsonArray(cards.Select(card => (JsonNode?)CardJson(card)).ToArray()),
                    ["notes"] = new JsonArray(_buffNotes.Notes.Select(note => (JsonNode?)note.DeepClone()).ToArray()),
                },
            };
            var doc = new JsonObject
            {
                ["kind"] = ConfigKind,
                ["version"] = ConfigVersion,
                ["team"] = team.Team.DeepClone(),
                ["axes"] = new JsonArray(new JsonObject
                {
                    ["id"] = "gcsim",
                    ["name"] = "gcsim 导入",
                    ["entries"] = _entries.DeepClone(),
                }),
                ["activeId"] = "gcsim",
            };
            return new GcsimImportResult { Doc = doc, Report = report };
        }

        private void ResolveCharacters()
        {
            var mappingChars = GcsimSupport.Property(_mapping, "characters");
            for (var i = 0; i < _details.Count; i++)
            {
                var detail = _details[i];
                string? id = null;
                if (!string.IsNullOrEmpty(detail.Name)
                    && mappingChars is { ValueKind: JsonValueKind.Object } map
                    && map.TryGetProperty(detail.Name, out var mapped)
                    && GcsimSupport.Truthy(mapped))
                {
                    id = GcsimSupport.StringValue(mapped);
                }
                id ??= GcsimSupport.ResolveByName(detail.Name, _catalogues.Characters);
                if (id is null)
                {
                    throw new GcsimImportException(
                        $"gcsim 角色「{detail.Name}」在本地目录里找不到；请在 gcsim-abilities.json 的 characters 里补一条");
                }
                _details[i] = new CharacterRef
                {
                    Index = detail.Index,
                    Id = id,
                    Detail = detail.Detail,
                    Name = detail.Name,
                };
                _indexById[id] = i;

                if (!_charData.TryGetValue(id, out var data))
                {
                    throw new GcsimImportException($"缺少角色数据文件 public/data/char/chs/{id}.json");
                }
                var element = GcsimSupport.Capitalise(
                    GcsimSupport.Text(GcsimSupport.Property(detail.Detail, "element")));
                _sources[i] = CharacterSources.BuildSources(
                    data,
                    string.IsNullOrEmpty(element) ? null : element,
                    _input.TalentDamage,
                    id,
                    LevelsFor(detail.Detail));
            }
        }

        private static Dictionary<string, int> LevelsFor(JsonElement detail)
        {
            var cons = GcsimSupport.NumberOrZero(GcsimSupport.Property(detail, "cons"));
            var talents = GcsimSupport.Property(detail, "talents");
            var attack = (int)Math.Truncate(GcsimSupport.NumberOrZero(GcsimSupport.Property(talents, "attack")) is var a && a != 0 ? a : 1);
            var skill = (int)Math.Truncate(GcsimSupport.NumberOrZero(GcsimSupport.Property(talents, "skill")) is var s && s != 0 ? s : 1);
            var burst = (int)Math.Truncate(GcsimSupport.NumberOrZero(GcsimSupport.Property(talents, "burst")) is var b && b != 0 ? b : 1);
            if (cons >= 3) skill += 3;
            if (cons >= 5) burst += 3;
            return new Dictionary<string, int>(StringComparer.Ordinal)
            {
                ["normal"] = attack,
                ["skill"] = skill,
                ["burst"] = burst,
            };
        }

        private TeamBuild BuildTeam()
        {
            var units = new JsonArray();
            var built = new List<UnitBuild>();
            var weaponOverrides = GcsimSupport.Property(_mapping, "weapons");
            for (var i = 0; i < _details.Count; i++)
            {
                var reference = _details[i];
                var detail = reference.Detail;
                var weaponName = GcsimSupport.Text(GcsimSupport.Property(
                    GcsimSupport.Property(detail, "weapon"), "name"));
                var weaponId = string.IsNullOrEmpty(weaponName)
                    ? null
                    : GcsimSupport.ResolveByName(weaponName, _catalogues.Weapons, weaponOverrides);
                var artifacts = ArtifactSlots(detail);
                var cons = (int)Math.Truncate(GcsimSupport.NumberOrZero(GcsimSupport.Property(detail, "cons")));
                var level = GcsimSupport.NumberOrZero(GcsimSupport.Property(detail, "level")) is var l && l != 0 ? l : 90;
                var refineValue = GcsimSupport.NumberOrZero(GcsimSupport.Property(
                    GcsimSupport.Property(detail, "weapon"), "refine"));
                var refine = (int)GcsimSupport.JsRound(refineValue != 0 ? refineValue : 1);
                var talents = GcsimSupport.Property(detail, "talents");
                var normal = (int)Math.Truncate(GcsimSupport.NumberOrZero(GcsimSupport.Property(talents, "attack")) is var n && n != 0 ? n : 1);
                var skill = (int)Math.Truncate(GcsimSupport.NumberOrZero(GcsimSupport.Property(talents, "skill")) is var s && s != 0 ? s : 1) + (cons >= 3 ? 3 : 0);
                var burst = (int)Math.Truncate(GcsimSupport.NumberOrZero(GcsimSupport.Property(talents, "burst")) is var b && b != 0 ? b : 1) + (cons >= 5 ? 3 : 0);

                var unit = new JsonObject
                {
                    ["id"] = "u" + (i + 1),
                    ["char"] = new JsonObject
                    {
                        ["id"] = reference.Id,
                        ["level"] = level,
                        ["constellation"] = cons,
                        ["talents"] = new JsonObject
                        {
                            ["normal"] = normal,
                            ["skill"] = skill,
                            ["burst"] = burst,
                        },
                    },
                    ["weapon"] = new JsonObject
                    {
                        ["id"] = weaponId,
                        ["refine"] = refine,
                    },
                    ["artifacts"] = new JsonObject
                    {
                        ["active"] = "a1",
                        ["sets"] = new JsonArray(new JsonObject
                        {
                            ["id"] = "a1",
                            ["name"] = "gcsim",
                            ["slots"] = artifacts.Slots.DeepClone(),
                        }),
                    },
                };
                units.Add(unit);
                built.Add(new UnitBuild
                {
                    CharId = reference.Id,
                    Detail = detail,
                    Level = level,
                    WeaponId = weaponId,
                    Artifacts = artifacts.Pieces,
                });
            }
            return new TeamBuild
            {
                Team = new JsonObject { ["version"] = 1, ["units"] = units },
                Units = built,
            };
        }

        private sealed class ArtifactSlotResult
        {
            public required JsonObject Slots { get; init; }
            public required Dictionary<string, ArtifactPiece> Pieces { get; init; }
        }

        private ArtifactSlotResult ArtifactSlots(JsonElement detail)
        {
            var slots = new JsonObject();
            var pieces = new Dictionary<string, ArtifactPiece>(StringComparer.Ordinal);
            foreach (var key in ArtifactModel.SlotKeys)
            {
                slots[key] = BlankPiece();
                pieces[key] = new ArtifactPiece();
            }

            var setOverrides = GcsimSupport.Property(_mapping, "sets");
            var sets = GcsimSupport.Property(detail, "sets");
            var slot = 0;
            if (sets is { ValueKind: JsonValueKind.Object } setObject)
            {
                foreach (var property in setObject.EnumerateObject())
                {
                    var setId = GcsimSupport.ResolveByName(property.Name, _catalogues.Artifacts, setOverrides);
                    if (setId is null) continue;
                    var entry = GcsimSupport.Property(_catalogues.Artifacts, setId) ?? default;
                    var storedId = GcsimSupport.CatalogueId(setId, entry);
                    var count = GcsimSupport.NumberOrZero(property.Value);
                    for (var n = 0; n < count && slot < ArtifactModel.SlotKeys.Length; n++)
                    {
                        ((JsonObject)slots[ArtifactModel.SlotKeys[slot]]!)["setId"] = storedId;
                        slot += 1;
                    }
                }
            }

            var rows = new List<(string Key, double Value)>();
            var mains = new List<(string Slot, string Key, double Value, int Index)>();
            if (GcsimSupport.Property(detail, "stats") is { ValueKind: JsonValueKind.Array } stats)
            {
                for (var index = 0; index < stats.GetArrayLength(); index++)
                {
                    var value = GcsimSupport.NumberOrZero(stats[index]);
                    if (value == 0) continue;
                    var spec = GsStat(index);
                    if (spec is null || spec.Value.Unit is null)
                    {
                        _statNotes.Add(new JsonObject
                        {
                            ["kind"] = "stat-unmapped",
                            ["index"] = index,
                            ["value"] = value,
                        });
                        continue;
                    }
                    var converted = GsPct.Contains(spec.Value.Key) ? value * 100 : value;
                    var unit = spec.Value.Unit!;
                    if (unit == "sub") rows.Add((spec.Value.Key, converted));
                    else mains.Add((unit, spec.Value.Key, converted, index));
                }
            }

            foreach (var main in mains)
            {
                double? level = null;
                foreach (var candidate in new[] { 0, 4, 8, 12, 16, 20 })
                {
                    var curve = ArtifactModel.MainStatValue(main.Key, candidate);
                    if (curve is not null && Math.Abs(curve.Value - main.Value) < 0.05)
                    {
                        level = candidate;
                        break;
                    }
                }
                if (level is null)
                {
                    _statNotes.Add(new JsonObject
                    {
                        ["kind"] = "stat-unrepresentable",
                        ["index"] = main.Index,
                        ["key"] = main.Key,
                        ["value"] = main.Value,
                    });
                    continue;
                }
                var pieceNode = (JsonObject)slots[main.Slot]!;
                pieceNode["mainStat"] = main.Key;
                pieceNode["level"] = level.Value;
                pieces[main.Slot].MainStat = main.Key;
                pieces[main.Slot].Level = level.Value;
            }

            var assigned = new Dictionary<string, List<(string Key, double Value)>>(StringComparer.Ordinal);
            foreach (var key in ArtifactModel.SlotKeys) assigned[key] = [];
            for (var i = 0; i < ArtifactModel.SlotKeys.Length; i++)
            {
                for (var j = 0; j < 4; j++)
                {
                    var rowIndex = i * 4 + j;
                    if (rowIndex >= rows.Count) break;
                    var row = rows[rowIndex];
                    assigned[ArtifactModel.SlotKeys[i]].Add(row);
                    var subArray = (JsonArray)((JsonObject)slots[ArtifactModel.SlotKeys[i]]!)["subStats"]!;
                    while (subArray.Count <= j) subArray.Add(null);
                    subArray[j] = new JsonObject
                    {
                        ["key"] = row.Key,
                        ["value"] = row.Value,
                    };
                }
            }
            foreach (var key in ArtifactModel.SlotKeys)
            {
                pieces[key].SubStats = assigned[key]
                    .Select(row => new ArtifactSubStat
                    {
                        Key = row.Key,
                        Value = JsonElementNumber(row.Value),
                    })
                    .ToList();
            }
            return new ArtifactSlotResult { Slots = slots, Pieces = pieces };
        }

        private static JsonObject BlankPiece()
        {
            var subStats = new JsonArray();
            for (var i = 0; i < 4; i++) subStats.Add(null);
            return new JsonObject
            {
                ["setId"] = null,
                ["mainStat"] = null,
                ["level"] = 0,
                ["subStats"] = subStats,
            };
        }

        private static JsonElement JsonElementNumber(double value)
        {
            using var document = JsonDocument.Parse(value.ToString("R", CultureInfo.InvariantCulture));
            return document.RootElement.Clone();
        }

        private static readonly Dictionary<int, (string Key, string? Unit)> GsStats = new()
        {
            [1] = ("defPct", "sub"), [2] = ("def", "sub"), [3] = ("hp", "sub"),
            [4] = ("hpPct", "sub"), [5] = ("atk", "sub"), [6] = ("atkPct", "sub"),
            [7] = ("er", "sub"), [8] = ("em", "sub"), [9] = ("critRate", "sub"),
            [10] = ("critDmg", "sub"), [11] = ("healBonus", "circlet"),
            [12] = ("pyroDmg", "goblet"), [13] = ("hydroDmg", "goblet"),
            [14] = ("cryoDmg", "goblet"), [15] = ("electroDmg", "goblet"),
            [16] = ("anemoDmg", "goblet"), [17] = ("geoDmg", "goblet"),
            [18] = ("dendroDmg", "goblet"), [19] = ("physBonus", "goblet"),
            [20] = ("atkSpd", null), [21] = ("dmgBonus", null),
        };

        private static readonly HashSet<string> GsPct = new(StringComparer.Ordinal)
        {
            "hpPct", "atkPct", "defPct", "er", "critRate", "critDmg", "healBonus",
            "pyroDmg", "hydroDmg", "cryoDmg", "electroDmg", "anemoDmg", "geoDmg",
            "dendroDmg", "physBonus", "dmgBonus",
        };

        private static (string Key, string? Unit)? GsStat(int index)
            => GsStats.TryGetValue(index, out var spec) ? spec : null;

        private void DerivePanels(List<UnitBuild> units)
        {
            foreach (var unit in units)
            {
                var charEntry = GcsimSupport.Property(_catalogues.Characters, unit.CharId);
                var element = GcsimSupport.Text(GcsimSupport.Property(charEntry, "element"));
                if (string.IsNullOrEmpty(element))
                {
                    element = GcsimSupport.Capitalise(
                        GcsimSupport.Text(GcsimSupport.Property(unit.Detail, "element")));
                }
                var weapon = unit.WeaponId is null
                    ? (JsonElement?)null
                    : GcsimSupport.Property(_catalogues.Weapons, unit.WeaponId);
                var panel = StatDeriver.DerivePanel(new DerivePanelInput
                {
                    CharId = unit.CharId,
                    Detail = unit.Detail,
                    Level = unit.Level,
                    Element = string.IsNullOrEmpty(element) ? null : element,
                    WeaponId = unit.WeaponId,
                    Weapon = weapon,
                    Artifacts = unit.Artifacts,
                    UseStats = true,
                }, _input.Stats);
                _panels[unit.CharId] = panel.Values;
            }
        }

        private void IndexLog()
        {
            if (GcsimSupport.Property(_sample, "logs") is not { ValueKind: JsonValueKind.Array } logs) return;
            var pending = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var index = 0; index < logs.GetArrayLength(); index++)
            {
                var entry = logs[index];
                var eventKind = GcsimSupport.Text(GcsimSupport.Property(entry, "event"));
                var inner = GcsimSupport.Property(entry, "logs") ?? default;
                var charIndex = (int)Math.Truncate(GcsimSupport.NumberOrZero(
                    GcsimSupport.Property(entry, "char_index")));
                if (eventKind == "damage")
                {
                    var key = charIndex + "|" + GcsimSupport.TemplateText(GcsimSupport.Property(inner, "abil"));
                    pending[key] = index;
                    var sourceFrame = GcsimSupport.Property(inner, "source_frame");
                    var hasSourceFrame = sourceFrame is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined };
                    _damage.Add(new DamageEvent
                    {
                        Index = index,
                        CharIndex = charIndex,
                        Frame = GcsimSupport.Property(entry, "frame") is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined } frame
                            ? GcsimSupport.Number(frame)
                            : 0,
                        Logs = inner,
                        HasSourceFrame = hasSourceFrame,
                        SourceFrameKey = hasSourceFrame ? GcsimSupport.TemplateText(sourceFrame) : null,
                        Ability = GcsimSupport.Text(GcsimSupport.Property(inner, "abil")),
                        Ele = GcsimSupport.Text(GcsimSupport.Property(inner, "ele")),
                    });
                }
                else if (eventKind == "calc")
                {
                    var key = charIndex + "|" + GcsimSupport.TemplateText(GcsimSupport.Property(inner, "abil"));
                    if (pending.TryGetValue(key, out var damageIndex))
                    {
                        var damage = _damage.FirstOrDefault(item => item.Index == damageIndex);
                        if (damage is not null) damage.Calc = entry;
                        pending.Remove(key);
                    }
                }
            }
        }

        private void CollectTimelines()
        {
            foreach (var damage in _damage)
            {
                if (IsReaction(damage.Ability) || AbilityRuleFor(damage.Ability) is not null) continue;
                var calc = GcsimSupport.Property(damage.Calc, "logs");
                var flat = GcsimSupport.NumberOrZero(GcsimSupport.Property(calc, "flat_dmg"));
                if (flat <= 0) continue;
                if (!_observedFlat.TryGetValue(damage.CharIndex, out var rows))
                {
                    rows = [];
                    _observedFlat[damage.CharIndex] = rows;
                }
                rows.Add((damage.Frame, flat));
            }

            if (GcsimSupport.Property(_sample, "logs") is not { ValueKind: JsonValueKind.Array } logs) return;
            foreach (var entry in logs.EnumerateArray())
            {
                if (GcsimSupport.Text(GcsimSupport.Property(entry, "event")) != "calc") continue;
                var inner = GcsimSupport.Property(entry, "logs");
                if (!(GcsimSupport.NumberOrZero(GcsimSupport.Property(inner, "base_atk")) > 0)) continue;
                var atk = GcsimSupport.Number(GcsimSupport.Property(inner, "total_scaling"));
                if (!double.IsFinite(atk) || atk <= 0) continue;
                var charIndex = (int)Math.Truncate(GcsimSupport.NumberOrZero(
                    GcsimSupport.Property(entry, "char_index")));
                if (!_scalingTimeline.TryGetValue(charIndex, out var rows))
                {
                    rows = [];
                    _scalingTimeline[charIndex] = rows;
                }
                var frame = GcsimSupport.Property(entry, "frame") is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined } frameNode
                    ? GcsimSupport.Number(frameNode)
                    : 0;
                rows.Add((frame, atk));
            }
        }

        private static List<JsonElement> RuleArray(JsonElement value)
            => value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().ToList() : [];

        private static bool IsReaction(string? ability)
            => Reaction().IsMatch(ability ?? string.Empty);

        private JsonElement? AbilityRuleFor(string? ability)
        {
            foreach (var rule in RuleArray(_flatRules))
            {
                var pattern = GcsimSupport.Text(GcsimSupport.Property(rule, "ability"));
                if (string.IsNullOrEmpty(pattern)) continue;
                if (pattern.Length > 2 && pattern.StartsWith('/') && pattern.EndsWith('/'))
                {
                    try
                    {
                        if (Regex.IsMatch(ability ?? string.Empty, pattern[1..^1], RegexOptions.CultureInvariant))
                        {
                            return rule;
                        }
                    }
                    catch (ArgumentException)
                    {
                        // A malformed local rule must not hide the other rules.
                    }
                }
                else if (pattern == ability)
                {
                    return rule;
                }
            }
            return null;
        }

        private List<double> FlatCandidates(JsonElement rule, double frame)
        {
            var values = new List<double>();
            var seen = new HashSet<double>();
            var observedBy = GcsimSupport.Property(rule, "observedBy");
            if (observedBy is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined })
            {
                var id = GcsimSupport.StringValue(observedBy.Value);
                if (_indexById.TryGetValue(id, out var index)
                    && _observedFlat.TryGetValue(index, out var rows))
                {
                    foreach (var row in rows)
                    {
                        if (seen.Add(row.Flat)) values.Add(row.Flat);
                    }
                }
                return values;
            }
            var of = GcsimSupport.Property(rule, "of");
            var factor = GcsimSupport.Property(rule, "factor");
            if (of is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined }
                && factor is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined })
            {
                var id = GcsimSupport.StringValue(of.Value);
                if (_indexById.TryGetValue(id, out var index)
                    && _scalingTimeline.TryGetValue(index, out var rows))
                {
                    var multiplier = GcsimSupport.Number(factor);
                    foreach (var row in rows)
                    {
                        if (Math.Abs(row.Frame - frame) > 300) continue;
                        var candidate = GcsimSupport.Round6(multiplier * row.Atk);
                        if (seen.Add(candidate)) values.Add(candidate);
                    }
                }
            }
            return values;
        }

        private static void SetHitBuff(Hit hit, string name, string source, string key, double value)
        {
            var id = name + "\0" + source + "\0" + key;
            if (hit.BuffIndex.TryGetValue(id, out var existing))
            {
                existing.Value = value;
                return;
            }
            hit.AddBuff(new HitBuff { Source = source, Key = key, Value = value }, id);
        }

        private void AttachCalcFlat(Hit hit, int charIndex, JsonElement calcLogs, double frame, string? ability)
        {
            var flat = GcsimSupport.NumberOrZero(GcsimSupport.Property(calcLogs, "flat_dmg"));
            if (flat <= 0) return;
            var exclusive = AbilityRuleFor(ability);
            if (exclusive is not null)
            {
                SetHitBuff(
                    hit,
                    "calc:flat_dmg",
                    GcsimSupport.Text(GcsimSupport.Property(exclusive.Value, "source")) ?? string.Empty,
                    "flatDmg",
                    GcsimSupport.Round6(flat));
                return;
            }

            var charId = _details[charIndex].Id;
            var rules = RuleArray(_flatRules)
                .Where(rule => GcsimSupport.Text(GcsimSupport.Property(rule, "ability")) is null)
                .Where(rule => GcsimSupport.Text(GcsimSupport.Property(rule, "notFor")) != charId)
                .ToList();
            if (rules.Count == 0)
            {
                _buffNotes.Add(new JsonObject
                {
                    ["kind"] = "buff-calc-flat-no-rule",
                    ["ability"] = ability,
                    ["value"] = GcsimSupport.Round6(flat),
                });
                return;
            }

            var candidates = rules.Select(rule => FlatCandidates(rule, frame)).ToList();
            Choice? best = null;
            var picks = new List<Pick>();
            void Walk(int index, double sum)
            {
                if (index == rules.Count)
                {
                    if (picks.Count == 0) return;
                    var error = Math.Abs(sum - flat);
                    if (best is null || error < best.Error)
                    {
                        best = new Choice { Error = error, Picks = picks.ToList() };
                    }
                    return;
                }
                Walk(index + 1, sum);
                foreach (var candidate in candidates[index])
                {
                    picks.Add(new Pick
                    {
                        Source = GcsimSupport.Text(GcsimSupport.Property(rules[index], "source")) ?? string.Empty,
                        Pred = candidate,
                    });
                    Walk(index + 1, sum + candidate);
                    picks.RemoveAt(picks.Count - 1);
                }
            }
            Walk(0, 0);
            if (best is null || best.Error > Math.Max(2, flat * 0.02))
            {
                _buffNotes.Add(new JsonObject
                {
                    ["kind"] = "buff-calc-flat-unexplained",
                    ["ability"] = ability,
                    ["value"] = GcsimSupport.Round6(flat),
                    ["closest"] = best is null ? null : GcsimSupport.Round6(best.Picks.Sum(pick => pick.Pred)),
                });
                best = new Choice
                {
                    Error = best?.Error ?? double.PositiveInfinity,
                    Picks =
                    [
                        new Pick
                        {
                            Source = GcsimSupport.Text(GcsimSupport.Property(rules[0], "source")) ?? string.Empty,
                            Pred = flat,
                        },
                    ],
                };
            }

            var chosen = best.Picks;
            var values = chosen.Select(_ => 0d).ToList();
            values[^1] = flat - values.Sum();
            if (values.Count > 1 && Math.Abs(values[^1]) <= 1)
            {
                values[^2] += values[^1];
                values[^1] = 0;
            }
            for (var i = 0; i < chosen.Count; i++)
            {
                if (values[i] == 0) continue;
                SetHitBuff(hit, "calc:flat_dmg", chosen[i].Source, "flatDmg", GcsimSupport.Round6(values[i]));
            }
        }

        private void AttachCalcIgnoreDef(Hit hit, int charIndex, JsonElement calcLogs)
        {
            var total = GcsimSupport.NumberOrZero(GcsimSupport.Property(calcLogs, "ignore_def"));
            if (total <= 1e-6) return;
            var charId = _details[charIndex].Id;
            var rules = RuleArray(_ignoreDefRules)
                .Where(rule => GcsimSupport.Text(GcsimSupport.Property(rule, "forChar")) is null
                    || GcsimSupport.Text(GcsimSupport.Property(rule, "forChar")) == charId)
                .ToList();
            Choice? best = null;
            var picks = new List<Pick>();
            void Walk(int index, double sum)
            {
                if (index == rules.Count)
                {
                    var error = Math.Abs(sum - total);
                    if (best is null || error < best.Error)
                    {
                        best = new Choice { Error = error, Picks = picks.ToList() };
                    }
                    return;
                }
                Walk(index + 1, sum);
                var share = GcsimSupport.NumberOrZero(GcsimSupport.Property(rules[index], "share"));
                picks.Add(new Pick
                {
                    Source = GcsimSupport.Text(GcsimSupport.Property(rules[index], "source")) ?? string.Empty,
                    Pred = share,
                });
                Walk(index + 1, sum + share);
                picks.RemoveAt(picks.Count - 1);
            }
            Walk(0, 0);
            if (best is null || best.Error > 0.005 || best.Picks.Count == 0)
            {
                if (best is not null && best.Error <= 0.005 && best.Picks.Count == 0) return;
                _buffNotes.Add(new JsonObject
                {
                    ["kind"] = "buff-calc-ignore-def-unexplained",
                    ["value"] = GcsimSupport.Round6(total * 100),
                });
                if (rules.Count > 0)
                {
                    SetHitBuff(
                        hit,
                        "calc:ignore_def",
                        GcsimSupport.Text(GcsimSupport.Property(rules[0], "source")) ?? string.Empty,
                        "defIgnore",
                        GcsimSupport.Round6(total * 100));
                }
                return;
            }
            foreach (var pick in best.Picks)
            {
                SetHitBuff(hit, "calc:ignore_def", pick.Source, "defIgnore", GcsimSupport.Round6(pick.Pred * 100));
            }
        }

        private void ApplyResidue(Hit hit, string key, double exact, double baseValue)
        {
            var cards = hit.Buffs.Where(buff => buff.Key == key).ToList();
            var residue = exact - baseValue - cards.Sum(buff => buff.Value);
            if (!double.IsFinite(residue) || Math.Abs(residue) < 1e-9) return;
            if (Math.Abs(residue) > 2)
            {
                _buffNotes.Add(new JsonObject
                {
                    ["kind"] = "buff-calc-stat-residual",
                    ["key"] = key,
                    ["value"] = GcsimSupport.Round6(residue),
                });
                return;
            }
            if (cards.Count == 0)
            {
                _buffNotes.Add(new JsonObject
                {
                    ["kind"] = "buff-calc-stat-no-card",
                    ["key"] = key,
                    ["value"] = GcsimSupport.Round6(residue),
                });
                return;
            }
            var largest = cards
                .Select((card, index) => (card, index))
                .OrderByDescending(item => Math.Abs(item.card.Value))
                .ThenBy(item => item.index)
                .First().card;
            largest.Value = GcsimSupport.Round6(largest.Value + residue);
        }

        private void AttachCalcBonus(Hit hit, JsonElement calcLogs, Dictionary<string, double>? panel)
        {
            var exact = GcsimSupport.Number(GcsimSupport.Property(calcLogs, "bonus_dmg"));
            if (!double.IsFinite(exact)) return;
            var elementPercent = GcsimSupport.NumberOrZero(GcsimSupport.Property(calcLogs, "ele_per"));
            ApplyResidue(hit, "dmgBonus", (exact - elementPercent) * 100, panel?.GetValueOrDefault("dmgBonus") ?? 0);
        }

        private void AttachCalcCrit(Hit hit, JsonElement calcLogs, Dictionary<string, double>? panel)
        {
            if (panel is null) return;
            var critDmg = GcsimSupport.Number(GcsimSupport.Property(calcLogs, "cd"));
            if (double.IsFinite(critDmg))
            {
                ApplyResidue(hit, "critDmg", critDmg * 100, panel.GetValueOrDefault("critDmg"));
            }
            var critRate = GcsimSupport.Number(GcsimSupport.Property(calcLogs, "cr"));
            if (double.IsFinite(critRate))
            {
                ApplyResidue(hit, "critRate", critRate * 100, panel.GetValueOrDefault("critRate"));
            }
        }

        private void AbsorbStatuses(Hit hit, JsonElement logs, JsonElement? calcLogs, DamageEvent damage)
        {
            if (logs.ValueKind != JsonValueKind.Object) return;
            void Absorb(string name, JsonElement raw)
            {
                var mapping = GcsimSupport.Property(_buffTable, name);
                if (!GcsimSupport.Truthy(mapping))
                {
                    _buffNotes.Add(new JsonObject
                    {
                        ["kind"] = "buff-status-unknown",
                        ["status"] = name,
                        ["ability"] = damage.Ability,
                    });
                    return;
                }
                foreach (var line in StatusLines(name, raw, mapping!.Value))
                {
                    var id = name + "\0" + line.Source + "\0" + line.Key;
                    if (hit.BuffIndex.TryGetValue(id, out var previous))
                    {
                        if (previous.Value != line.Value)
                        {
                            _buffNotes.Add(new JsonObject
                            {
                                ["kind"] = "buff-value-drift",
                                ["status"] = name,
                                ["source"] = line.Source,
                                ["key"] = line.Key,
                                ["from"] = previous.Value,
                                ["to"] = line.Value,
                                ["ability"] = damage.Ability,
                            });
                        }
                        continue;
                    }
                    hit.AddBuff(line, id);
                }
            }

            void AbsorbShred(string name, JsonElement raw, bool resist)
            {
                var mapping = GcsimSupport.Property(_buffTable, name);
                if (mapping is not { ValueKind: JsonValueKind.String } sourceNode)
                {
                    _buffNotes.Add(new JsonObject
                    {
                        ["kind"] = "buff-status-unknown",
                        ["status"] = name,
                        ["ability"] = damage.Ability,
                    });
                    return;
                }
                var source = sourceNode.GetString() ?? string.Empty;
                var lines = ParseLines(raw);
                var amount = lines.TryGetValue("amount", out var amountText)
                    ? GcsimSupport.Number(JsonText(amountText))
                    : double.NaN;
                var suffix = resist ? DamageTypeSuffix(lines.GetValueOrDefault("ele")) : null;
                if (!double.IsFinite(amount) || (resist && suffix is null))
                {
                    var note = new JsonObject
                    {
                        ["kind"] = "buff-inactive",
                        ["status"] = name,
                        ["line"] = "amount",
                    };
                    if (lines.TryGetValue("amount", out var text)) note["text"] = text;
                    _buffNotes.Add(note);
                    return;
                }
                var key = resist ? "resShred" + suffix : "defShred";
                var value = GcsimSupport.Round6(Math.Abs(amount) * 100);
                var id = name + "\0" + source + "\0" + key;
                if (hit.BuffIndex.TryGetValue(id, out var previous))
                {
                    if (previous.Value != value)
                    {
                        _buffNotes.Add(new JsonObject
                        {
                            ["kind"] = "buff-value-drift",
                            ["status"] = name,
                            ["source"] = source,
                            ["key"] = key,
                            ["from"] = previous.Value,
                            ["to"] = value,
                            ["ability"] = damage.Ability,
                        });
                    }
                    return;
                }
                hit.AddBuff(new HitBuff { Source = source, Key = key, Value = value }, id);
            }

            foreach (var property in logs.EnumerateObject())
            {
                if (HitKeys.Contains(property.Name)) continue;
                switch (property.Name)
                {
                    case "pre_damage_mods":
                        foreach (var (name, raw) in NestedStatuses(property.Value)) Absorb(name, raw);
                        continue;
                    case "resist_mods":
                        foreach (var (name, raw) in NestedStatuses(property.Value)) AbsorbShred(name, raw, true);
                        continue;
                    case "def_mods":
                        foreach (var (name, raw) in NestedStatuses(property.Value)) AbsorbShred(name, raw, false);
                        continue;
                    default:
                        Absorb(property.Name, property.Value);
                        break;
                }
            }

            if (calcLogs is not null
                && damage.Ability is not null
                && (HasAbility(_abilities, _details[damage.CharIndex].Id, damage.Ability)
                    || HasProperty(_teamAbilities, damage.Ability)))
            {
                AttachCalcFlat(hit, damage.CharIndex, calcLogs.Value, damage.Frame, damage.Ability);
                AttachCalcIgnoreDef(hit, damage.CharIndex, calcLogs.Value);
                var panel = _panels.GetValueOrDefault(_details[damage.CharIndex].Id);
                AttachCalcBonus(hit, calcLogs.Value, panel);
                AttachCalcCrit(hit, calcLogs.Value, panel);
            }
        }

        private List<HitBuff> StatusLines(string name, JsonElement raw, JsonElement mapping)
        {
            var result = new List<HitBuff>();
            var lines = new List<(string Key, string Text)>();
            if (raw.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in raw.EnumerateArray())
                {
                    var text = GcsimSupport.StringValue(item);
                    var at = text.IndexOf(':');
                    var key = at < 0 ? text.Trim() : text[..at].Trim();
                    var value = at < 0 ? string.Empty : text[(at + 1)..].Trim();
                    if (key.Length == 0 || key is "status" or "expiry_frame") continue;
                    lines.Add((key, value));
                }
            }

            if (mapping.ValueKind == JsonValueKind.String)
            {
                var source = mapping.GetString() ?? string.Empty;
                foreach (var (key, text) in lines)
                {
                    if (key == "reason")
                    {
                        _buffNotes.Add(new JsonObject
                        {
                            ["kind"] = "buff-inactive",
                            ["status"] = name,
                            ["line"] = key,
                            ["text"] = text,
                        });
                        continue;
                    }
                    if (!LineStats.TryGetValue(key, out var spec))
                    {
                        _buffNotes.Add(new JsonObject
                        {
                            ["kind"] = "buff-line-unknown",
                            ["status"] = name,
                            ["line"] = key,
                        });
                        continue;
                    }
                    var number = GcsimSupport.Number(JsonText(text));
                    if (!double.IsFinite(number))
                    {
                        _buffNotes.Add(new JsonObject
                        {
                            ["kind"] = "buff-inactive",
                            ["status"] = name,
                            ["line"] = key,
                            ["text"] = text,
                        });
                        continue;
                    }
                    result.Add(new HitBuff
                    {
                        Source = source,
                        Key = spec.Key,
                        Value = GcsimSupport.Round6(spec.Pct ? number * 100 : number),
                    });
                }
                return result;
            }

            if (mapping.ValueKind != JsonValueKind.Object) return result;
            foreach (var (key, _) in lines)
            {
                if (!mapping.TryGetProperty(key, out var entry) || entry.ValueKind != JsonValueKind.Object)
                {
                    _buffNotes.Add(new JsonObject
                    {
                        ["kind"] = "buff-line-unknown",
                        ["status"] = name,
                        ["line"] = key,
                    });
                    continue;
                }
                var source = GcsimSupport.Text(GcsimSupport.Property(entry, "source")) ?? string.Empty;
                if (GcsimSupport.Property(entry, "stats") is not { ValueKind: JsonValueKind.Object } stats) continue;
                foreach (var stat in stats.EnumerateObject())
                {
                    result.Add(new HitBuff
                    {
                        Source = source,
                        Key = stat.Name,
                        Value = GcsimSupport.Number(stat.Value),
                    });
                }
            }
            return result;
        }

        private static Dictionary<string, string> ParseLines(JsonElement raw)
        {
            var lines = new Dictionary<string, string>(StringComparer.Ordinal);
            if (raw.ValueKind != JsonValueKind.Array) return lines;
            foreach (var item in raw.EnumerateArray())
            {
                var text = GcsimSupport.StringValue(item);
                var at = text.IndexOf(':');
                if (at < 0) continue;
                lines[text[..at].Trim()] = text[(at + 1)..].Trim();
            }
            return lines;
        }

        private static IEnumerable<(string Name, JsonElement Raw)> NestedStatuses(JsonElement raw)
        {
            if (raw.ValueKind != JsonValueKind.Array) yield break;
            var list = raw.EnumerateArray().ToArray();
            for (var i = 0; i < list.Length; i++)
            {
                if (list[i].ValueKind == JsonValueKind.String
                    && i + 1 < list.Length
                    && list[i + 1].ValueKind == JsonValueKind.Array)
                {
                    yield return (list[i].GetString() ?? string.Empty, list[i + 1]);
                    i += 1;
                }
            }
        }

        private static JsonElement JsonText(string text)
        {
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(text));
            return document.RootElement.Clone();
        }

        private static string? DamageTypeSuffix(string? element)
        {
            return (element ?? string.Empty).ToLowerInvariant() switch
            {
                "pyro" => "Pyro",
                "hydro" => "Hydro",
                "cryo" => "Cryo",
                "electro" => "Electro",
                "anemo" => "Anemo",
                "geo" => "Geo",
                "dendro" => "Dendro",
                "physical" => "Physical",
                _ => null,
            };
        }

        private static bool HasAbility(JsonElement abilities, string charId, string ability)
            => abilities.ValueKind == JsonValueKind.Object
                && abilities.TryGetProperty(charId, out var rows)
                && rows.ValueKind == JsonValueKind.Object
                && rows.TryGetProperty(ability, out var value)
                && GcsimSupport.Truthy(value);

        private static bool HasProperty(JsonElement value, string name)
            => value.ValueKind == JsonValueKind.Object
                && value.TryGetProperty(name, out var property)
                && GcsimSupport.Truthy(property);

        private static readonly HashSet<string> HitKeys = new(StringComparer.Ordinal)
        {
            "abil", "amp", "attack-tag", "cata", "crit", "damage", "ele",
            "source_frame", "target",
        };

        private static readonly Dictionary<string, (string Key, bool Pct)> LineStats = new(StringComparer.Ordinal)
        {
            ["atk"] = ("atk", false), ["hp"] = ("hp", false), ["def"] = ("def", false),
            ["em"] = ("em", false), ["atk%"] = ("atkPct", true), ["hp%"] = ("hpPct", true),
            ["def%"] = ("defPct", true), ["er"] = ("er", true), ["cr"] = ("critRate", true),
            ["cd"] = ("critDmg", true), ["dmg%"] = ("dmgBonus", true),
            ["atkspd%"] = ("speed", true), ["heal%"] = ("healBonus", true),
            ["phys%"] = ("physBonus", true), ["pyro%"] = ("pyroDmg", true),
            ["hydro%"] = ("hydroDmg", true), ["cryo%"] = ("cryoDmg", true),
            ["electro%"] = ("electroDmg", true), ["anemo%"] = ("anemoDmg", true),
            ["geo%"] = ("geoDmg", true), ["dendro%"] = ("dendroDmg", true),
        };

        private static Cast NewCast(DamageEvent damage) => new()
        {
            CharIndex = damage.CharIndex,
            Ability = damage.Ability,
            Ele = damage.Ele,
        };

        private AbilityReport NoteAbility(string charName, string ability, double hits, bool mapped, bool ignored)
        {
            var key = charName + "|" + ability;
            if (!_abilityByKey.TryGetValue(key, out var row))
            {
                row = new AbilityReport
                {
                    Char = charName,
                    Ability = ability,
                    Mapped = mapped,
                    Ignored = ignored,
                };
                _abilityByKey[key] = row;
                _byAbility.Add(row);
            }
            row.Hits += hits;
            return row;
        }

        private void Flush(Cast cast)
        {
            var reference = _details[cast.CharIndex];
            var ability = cast.Ability ?? string.Empty;
            var mapped = FindAbility(_abilities, reference.Id, ability) ?? FindTeamAbility(ability);
            var ignored = HasProperty(_ignored, ability) || IsReaction(ability);
            var report = NoteAbility(reference.Name ?? string.Empty, ability, cast.Hits, mapped is not null, ignored);
            if (mapped is null) return;

            var mappedSource = GcsimSupport.Text(GcsimSupport.Element(mapped["source"]));
            var sourceKey = mappedSource == FlatSourcePrefix
                ? FlatSourceKey(cast.Ele ?? GcsimSupport.Text(GcsimSupport.Property(reference.Detail, "element")))
                : mappedSource ?? string.Empty;
            var src = (_sources[cast.CharIndex] ?? []).FirstOrDefault(source => source.Key == sourceKey);
            var mappedStage = GcsimSupport.Text(GcsimSupport.Element(mapped["stage"]));
            var stage = src?.Stages.FirstOrDefault(item => item.Chs == mappedStage);
            if (src is null || stage is null)
            {
                report.Mapped = false;
                report.Stale = true;
                return;
            }
            var stageIndex = src.Stages.IndexOf(stage);
            var sourceLabel = SourceJson(src, stageIndex, cast.Hits);
            var enemyOverrides = new JsonObject();
            if (_enemyLevel is not null)
            {
                enemyOverrides["enemyLevel"] = JsonNode.Parse(_enemyLevel.Value.GetRawText());
            }
            var groups = cast.Events;
            var critAll = cast.CritAll;
            var critNone = cast.CritNone;

            if (groups.Count <= 1)
            {
                var group = groups[0];
                var scaling = ScalingFor(cast.Hits, stage.Hits);
                var ratio = MultRatio(group.Talent, stage.Mult);
                if (src.Kind == "flat" && ratio is not null) scaling["mult"] = group.Talent;
                var drops = AttachCards(group.Buffs, cast.Hits);
                if (src.Kind != "flat" && ratio is not null) drops.Add(MultZoneDrop(ratio.Value));
                var entry = new JsonObject
                {
                    ["id"] = NextId(),
                    ["charId"] = reference.Id,
                    ["element"] = ElementOf(group.Ele ?? cast.Ele),
                    ["drops"] = drops,
                    ["statOverrides"] = enemyOverrides,
                    ["critMode"] = critAll ? "crit" : critNone ? "never" : "avg",
                    ["picked"] = new JsonObject
                    {
                        ["sourceKey"] = sourceKey,
                        ["stageIndex"] = stageIndex,
                    },
                    ["summary"] = new JsonObject
                    {
                        ["sourceKey"] = sourceKey,
                        ["sourceLabel"] = sourceLabel,
                    },
                    ["note"] = NoteText(cast.Hits, cast.Total, critAll, critNone),
                };
                if (scaling.Count > 0) entry["scaling"] = scaling;
                _entries.Add(entry);
                return;
            }

            var parentId = NextId();
            var parts = new JsonArray();
            var children = new JsonArray();
            for (var i = 0; i < groups.Count; i++)
            {
                var group = groups[i];
                var localMult = stage.Parts is not null && i < stage.Parts.Count ? stage.Parts[i].Mult : stage.Mult;
                var localHits = stage.Parts is not null && i < stage.Parts.Count ? stage.Parts[i].Hits : stage.Hits;
                parts.Add(new JsonObject
                {
                    ["partIndex"] = i,
                    ["mult"] = localMult,
                    ["hits"] = 1,
                });
                var scaling = ScalingFor(1, localHits);
                var ratio = MultRatio(group.Talent, localMult);
                if (src.Kind == "flat" && ratio is not null) scaling["mult"] = group.Talent;
                var drops = AttachCards(group.Buffs, 1);
                if (src.Kind != "flat" && ratio is not null) drops.Add(MultZoneDrop(ratio.Value));
                var child = new JsonObject
                {
                    ["id"] = parentId + "-p" + i,
                    ["partIndex"] = i,
                    ["element"] = ElementOf(group.Ele),
                    ["drops"] = drops,
                    ["statOverrides"] = enemyOverrides.DeepClone(),
                    ["critMode"] = group.Crit ? "crit" : "never",
                    ["expanded"] = false,
                };
                if (scaling.Count > 0) child["scaling"] = scaling;
                children.Add(child);
            }
            _entries.Add(new JsonObject
            {
                ["id"] = parentId,
                ["charId"] = reference.Id,
                ["element"] = ElementOf(cast.Ele),
                ["drops"] = new JsonArray(),
                ["statOverrides"] = enemyOverrides,
                ["critMode"] = critAll ? "crit" : critNone ? "never" : "avg",
                ["picked"] = new JsonObject
                {
                    ["sourceKey"] = sourceKey,
                    ["stageIndex"] = stageIndex,
                },
                ["summary"] = new JsonObject
                {
                    ["sourceKey"] = sourceKey,
                    ["sourceLabel"] = sourceLabel,
                    ["parts"] = parts,
                    ["partCount"] = groups.Count,
                    ["perHit"] = cast.Hits != 0 ? cast.Total / cast.Hits : 0,
                    ["total"] = cast.Total,
                    ["hits"] = cast.Hits,
                },
                ["children"] = children,
                ["note"] = NoteText(cast.Hits, cast.Total, critAll, critNone),
            });
        }

        private static JsonObject? FindAbility(JsonElement abilities, string charId, string ability)
        {
            if (abilities.ValueKind != JsonValueKind.Object
                || !abilities.TryGetProperty(charId, out var rows)
                || rows.ValueKind != JsonValueKind.Object
                || !rows.TryGetProperty(ability, out var mapped)
                || !GcsimSupport.Truthy(mapped))
            {
                return null;
            }
            return GcsimSupport.AsObject(mapped);
        }

        private JsonObject? FindTeamAbility(string ability)
            => _teamAbilities.ValueKind == JsonValueKind.Object
                && _teamAbilities.TryGetProperty(ability, out var mapped)
                && GcsimSupport.Truthy(mapped)
                    ? GcsimSupport.AsObject(mapped)
                    : null;

        private static string FlatSourceKey(string? element)
            => FlatSourcePrefix + "-" + (element ?? string.Empty).ToLowerInvariant();

        private static string? ElementOf(string? element)
            => string.IsNullOrEmpty(element) ? null : char.ToUpperInvariant(element[0]) + element[1..];

        private static JsonObject ScalingFor(double hits, double localHits)
        {
            var scaling = new JsonObject();
            if (localHits != 0 && hits != localHits) scaling["hits"] = hits;
            return scaling;
        }

        private static double? MultRatio(double? talent, double localMult)
        {
            if (talent is null || !double.IsFinite(talent.Value) || localMult == 0) return null;
            return Math.Abs(talent.Value / localMult - 1) > 1e-6 ? talent.Value / localMult : null;
        }

        private static JsonObject MultZoneDrop(double ratio) => new()
        {
            ["id"] = "d-mult-zone",
            ["source"] = new JsonObject
            {
                ["kind"] = "other",
                ["icon"] = null,
                ["iconKind"] = null,
                ["libKey"] = "mult-zone",
                ["name"] = new JsonObject
                {
                    ["chs"] = "倍率乘区",
                    ["en"] = "Multiplier Zone",
                },
            },
            ["buffs"] = new JsonArray(new JsonObject
            {
                ["key"] = "multZone",
                ["value"] = GcsimSupport.Round6(ratio),
                ["tag"] = string.Empty,
            }),
        };

        private JsonArray AttachCards(List<HitBuff> buffs, double count)
        {
            var cards = RowDrops(buffs);
            foreach (var node in cards)
            {
                if (node is not JsonObject card || card["source"] is not JsonObject source) continue;
                var libKey = GcsimSupport.Text(GcsimSupport.Element(source["libKey"])) ?? string.Empty;
                if (!_cardByKey.TryGetValue(libKey, out var record))
                {
                    record = new CardReport
                    {
                        LibKey = libKey,
                        Kind = GcsimSupport.Text(GcsimSupport.Element(source["kind"])) ?? string.Empty,
                        Name = source["name"]?.DeepClone(),
                    };
                    _cardByKey[libKey] = record;
                    _cards.Add(record);
                }
                record.Rows += 1;
                record.Hits += count;
            }
            return cards;
        }

        private JsonArray RowDrops(List<HitBuff> buffs)
        {
            var bySource = new Dictionary<string, List<HitBuff>>(StringComparer.Ordinal);
            var order = new List<string>();
            foreach (var buff in buffs)
            {
                if (!bySource.TryGetValue(buff.Source, out var list))
                {
                    list = [];
                    bySource[buff.Source] = list;
                    order.Add(buff.Source);
                }
                list.Add(buff);
            }

            var result = new JsonArray();
            foreach (var key in order.OrderBy(item => item, StringComparer.Ordinal))
            {
                var source = SourceOf(key);
                if (source is null)
                {
                    _buffNotes.Add(new JsonObject
                    {
                        ["kind"] = "buff-source-missing",
                        ["source"] = key,
                    });
                    continue;
                }
                var entries = new JsonArray();
                foreach (var buff in bySource[key])
                {
                    entries.Add(new JsonObject
                    {
                        ["key"] = buff.Key,
                        ["value"] = buff.Value,
                        ["tag"] = string.Empty,
                    });
                }
                result.Add(new JsonObject
                {
                    ["id"] = "d-" + key,
                    ["source"] = source.DeepClone(),
                    ["buffs"] = entries,
                });
            }
            return result;
        }

        private JsonObject? SourceOf(string key)
        {
            if (_sourcesByKey.TryGetValue(key, out var known)) return known;
            if (_extraSources.ValueKind != JsonValueKind.Object
                || !_extraSources.TryGetProperty(key, out var extra)
                || !GcsimSupport.Truthy(extra))
            {
                return null;
            }

            var result = new JsonObject
            {
                ["icon"] = null,
                ["iconKind"] = null,
            };
            if (extra.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in extra.EnumerateObject())
                {
                    if (property.Name == "libKey") continue;
                    result[property.Name] = JsonNode.Parse(property.Value.GetRawText());
                }
            }
            result["libKey"] = key;
            return result;
        }

        private string NextId() => "e" + (++_sequence).ToString(CultureInfo.InvariantCulture);

        private static string NoteText(double hits, double total, bool critAll, bool critNone)
        {
            var per = hits != 0 ? total / hits : total;
            var crit = critAll ? "全暴击" : critNone ? "未暴击" : "暴击混合";
            return $"gcsim：{GcsimSupport.NumberText(hits)} 击 · 单击 {Format(per)} · 合计 {Format(total)} · {crit}";
        }

        private static string Format(double value)
            => value.ToString("#,##0.00", CultureInfo.InvariantCulture);

        private static JsonObject RowJson(AbilityReport row)
        {
            var result = new JsonObject
            {
                ["char"] = row.Char,
                ["ability"] = row.Ability,
                ["hits"] = row.Hits,
                ["mapped"] = row.Mapped,
                ["ignored"] = row.Ignored,
            };
            if (row.Stale) result["stale"] = true;
            return result;
        }

        private static JsonObject CardJson(CardReport card) => new()
        {
            ["libKey"] = card.LibKey,
            ["kind"] = card.Kind,
            ["name"] = card.Name?.DeepClone(),
            ["rows"] = card.Rows,
            ["hits"] = card.Hits,
        };

        private static JsonObject SourceJson(DamageSource source, int replaceStage = -1, double stageHits = 0)
        {
            var result = new JsonObject
            {
                ["key"] = source.Key,
                ["kind"] = source.Kind,
            };
            if (source.IncludeIcon) result["icon"] = source.Icon;
            if (source.Kind == "flat") result["iconKind"] = source.IconKind;
            result["chs"] = source.Chs;
            result["en"] = source.En;
            result["element"] = source.Element;

            var stages = new JsonArray();
            for (var index = 0; index < source.Stages.Count; index++)
            {
                var stage = source.Stages[index];
                var stageJson = new JsonObject
                {
                    ["chs"] = stage.Chs,
                    ["en"] = stage.En,
                    ["mult"] = stage.Mult,
                    ["hits"] = index == replaceStage ? stageHits : stage.Hits,
                };
                if (stage.Terms is not null)
                {
                    var terms = new JsonArray();
                    foreach (var term in stage.Terms)
                    {
                        terms.Add(new JsonObject
                        {
                            ["mult"] = term.Mult,
                            ["hits"] = term.Hits,
                        });
                    }
                    stageJson["terms"] = terms;
                }
                if (stage.Parts is null)
                {
                    stageJson["parts"] = null;
                }
                else
                {
                    var parts = new JsonArray();
                    foreach (var part in stage.Parts)
                    {
                        parts.Add(new JsonObject
                        {
                            ["mult"] = part.Mult,
                            ["hits"] = part.Hits,
                            ["partIndex"] = part.PartIndex,
                        });
                    }
                    stageJson["parts"] = parts;
                }
                if (stage.IncludeBasis) stageJson["basis"] = stage.Basis;
                stages.Add(stageJson);
            }
            result["stages"] = stages;
            return result;
        }

        [GeneratedRegex("^swirl-|^(overloaded|superconduct|electro-?charged|shattered|burning|bloom|hyperbloom|burgeon|aggravate|spread|quicken|vaporize|melt|freeze|crystallize|burning)$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
        private static partial Regex Reaction();
    }
}
