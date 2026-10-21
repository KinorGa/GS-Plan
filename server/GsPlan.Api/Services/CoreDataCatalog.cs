using System.Text.Json;
using GsPlan.Api.Infrastructure;
using GsPlan.Core.Stats;

namespace GsPlan.Api.Services;

/// <summary>
/// Read-only, lazily cached access to the data files the axis needs. Keeping the
/// character detail and weapon catalogue on this side means the browser can send
/// the build rather than every character's full talent file.
/// </summary>
public sealed class CoreDataCatalog
{
    private readonly string _publicData;
    private readonly StatsCatalog _stats;
    private readonly object _gate = new();
    private readonly Dictionary<string, JsonElement?> _details = new(StringComparer.Ordinal);
    private readonly Dictionary<string, JsonElement?> _artifactDetails = new(StringComparer.Ordinal);
    private readonly Dictionary<string, JsonElement?> _lists = new(StringComparer.Ordinal);
    private JsonElement? _weapons;
    private bool _weaponsLoaded;
    private JsonElement? _talentDamage;
    private bool _talentDamageLoaded;

    public CoreDataCatalog(ResolvedPaths paths, StatsCatalog stats)
    {
        _publicData = Path.Combine(paths.RepoRoot, "public", "data");
        _stats = stats;
    }

    public StatsCompact Stats => _stats.Get();

    public JsonElement? GcsimMapping => GetList("gcsim-abilities.json");

    public JsonElement? CharacterCatalogue => GetList("charlist.json");

    public JsonElement? WeaponCatalogue => GetList("weaponlist.json");

    public JsonElement? ArtifactCatalogue => GetList("artifactlist.json");

    public JsonElement? GetCharacterDetail(string lang, string id)
    {
        if (!SafeSegment(lang) || !SafeSegment(id)) return null;
        var key = lang + "/" + id;
        lock (_gate)
        {
            if (_details.TryGetValue(key, out var cached)) return cached;
            var path = Path.Combine(_publicData, "char", lang, id + ".json");
            var value = ReadJson(path);
            _details[key] = value;
            return value;
        }
    }

    public JsonElement? GetWeapon(string id)
    {
        if (!SafeSegment(id)) return null;
        var weapons = GetWeapons();
        return weapons is { ValueKind: JsonValueKind.Object } value
            && value.TryGetProperty(id, out var weapon)
            ? weapon.Clone()
            : null;
    }

    public JsonElement? GetArtifactDetail(string lang, string id)
    {
        if (!SafeSegment(lang) || !SafeSegment(id)) return null;
        var key = lang + "/" + id;
        lock (_gate)
        {
            if (_artifactDetails.TryGetValue(key, out var cached)) return cached;
            var path = Path.Combine(_publicData, "artifact", lang, id + ".json");
            var value = ReadJson(path);
            _artifactDetails[key] = value;
            return value;
        }
    }

    private JsonElement? GetList(string name)
    {
        lock (_gate)
        {
            if (_lists.TryGetValue(name, out var cached)) return cached;
            var value = ReadJson(Path.Combine(_publicData, name));
            _lists[name] = value;
            return value;
        }
    }

    public JsonElement? TalentDamage
    {
        get
        {
            lock (_gate)
            {
                if (!_talentDamageLoaded)
                {
                    _talentDamage = ReadJson(Path.Combine(_publicData, "talent-damage.json"));
                    _talentDamageLoaded = true;
                }
                return _talentDamage;
            }
        }
    }

    private JsonElement? GetWeapons()
    {
        lock (_gate)
        {
            if (!_weaponsLoaded)
            {
                _weapons = ReadJson(Path.Combine(_publicData, "weaponlist.json"));
                _weaponsLoaded = true;
            }
            return _weapons;
        }
    }

    private static JsonElement? ReadJson(string path)
    {
        if (!File.Exists(path)) return null;
        try
        {
            using var stream = File.OpenRead(path);
            using var document = JsonDocument.Parse(stream);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
        catch (IOException)
        {
            return null;
        }
    }

    private static bool SafeSegment(string value)
        => !string.IsNullOrWhiteSpace(value)
            && value is not "." and not ".."
            && Path.GetFileName(value) == value
            && value.IndexOfAny(Path.GetInvalidFileNameChars()) < 0;
}
