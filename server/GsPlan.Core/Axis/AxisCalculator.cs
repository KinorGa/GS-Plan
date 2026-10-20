using GsPlan.Core.Damage;

namespace GsPlan.Core.Axis;

/// <summary>
/// Computes a whole damage axis from data alone. Ported from
/// <c>src/lib/axis-compute.js</c>; the single-hit formula remains in
/// <see cref="DamageCalculator"/>.
/// </summary>
public static class AxisCalculator
{
    public static AxisResult Compute(AxisRequest request, AxisComputationData data)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(data);
        var context = new AxisContext(data);
        var byId = new Dictionary<string, AxisEntryResult>(StringComparer.Ordinal);
        var total = 0d;
        var perHit = 0d;

        foreach (var entry in request.Entries ?? [])
        {
            var result = ComputeEntry(entry, context);
            if (result is null) continue;
            byId[entry.Id] = result;
            total += result.Total;
            perHit += result.PerHit;

            if (result.Loop == true)
            {
                for (var i = 0; i < (entry.Children?.Count ?? 0); i++)
                {
                    if (i >= (result.Children?.Count ?? 0)) break;
                    byId[entry.Children![i].Id] = result.Children![i];
                }
            }
        }

        return new AxisResult
        {
            ById = byId,
            Total = total,
            PerHit = perHit,
            Computed = byId.Count,
            Entries = request.Entries?.Count ?? 0,
        };
    }

    private static AxisEntryResult? ComputeEntry(AxisEntry? entry, AxisContext context)
    {
        if (entry is null) return null;

        if (entry.Kind == "segment")
        {
            var children = (entry.Children ?? [])
                .Select(child => ComputeEntry(child, context))
                .Where(child => child is not null)
                .Cast<AxisEntryResult>()
                .ToList();
            if (children.Count == 0) return null;
            return new AxisEntryResult
            {
                Loop = true,
                Children = children,
                PerHit = children.Sum(child => child.PerHit),
                Total = children.Sum(child => child.Total),
                Hits = 1,
            };
        }

        if (entry.CharId == "none" || string.IsNullOrEmpty(entry.CharId)) return null;

        var panel = context.PanelForEntry(entry);
        if (!panel.HasDetail) return null;
        var sources = context.SourcesForEntry(entry);
        if (sources.Count == 0) return null;

        if (entry.Children is { Count: > 0 })
        {
            var parentBasis = EntryScalingBasis(entry, "atk");
            var parts = new List<AxisPartResult>();
            foreach (var child in entry.Children)
            {
                var part = ComputePart(
                    entry,
                    context,
                    panel,
                    sources,
                    child.PartIndex ?? 0,
                    NullIfEmpty(child.Element),
                    child.Drops,
                    child.StatOverrides,
                    NullIfEmpty(child.CritMode ?? entry.CritMode),
                    child.Scaling?.Mult,
                    child.Scaling?.Hits,
                    EntryScalingBasis(child, parentBasis));
                if (part is not null) parts.Add(part);
            }
            if (parts.Count == 0) return null;
            return new AxisEntryResult
            {
                Parts = parts,
                PerHit = parts.Sum(part => part.PerHit),
                Total = parts.Sum(part => part.Total),
                Hits = 1,
            };
        }

        var one = ComputePart(
            entry,
            context,
            panel,
            sources,
            entry.Summary?.PartIndex ?? 0,
            NullIfEmpty(entry.Element),
            entry.Drops,
            null,
            NullIfEmpty(entry.CritMode),
            entry.Scaling?.Mult,
            entry.Scaling?.Hits,
            EntryScalingBasis(entry, "atk"));
        if (one is null) return null;
        return new AxisEntryResult
        {
            Parts = [one],
            PerHit = one.PerHit,
            Total = one.Total,
            Hits = one.Hits,
        };
    }

    private static AxisPartResult? ComputePart(
        AxisEntry entry,
        AxisContext context,
        AxisPanelState panel,
        IReadOnlyList<DamageSource> sources,
        int partIndex,
        string? element,
        IReadOnlyList<AxisDrop>? drops,
        IReadOnlyDictionary<string, double>? overrides,
        string? critMode,
        double? multiplierOverride,
        double? hitsOverride,
        string basis)
    {
        var summary = entry.Summary;
        var requestedKey = !string.IsNullOrEmpty(summary?.SourceKey)
            ? summary.SourceKey
            : entry.Picked?.SourceKey;
        var source = sources.FirstOrDefault(item => item.Key == requestedKey) ?? sources[0];

        var requestedStage = summary?.StageIndex ?? entry.Picked?.StageIndex ?? 0;
        var stageIndex = Math.Min(Math.Max(0, requestedStage), source.Stages.Count - 1);
        if (stageIndex < 0) return null;
        var stage = source.Stages[stageIndex];

        var stageParts = stage.Parts;
        var clampedIndex = Math.Min(Math.Max(0, partIndex), (stageParts?.Count ?? 1) - 1);
        var activePart = stageParts is { Count: > 0 } && clampedIndex < stageParts.Count
            ? stageParts[clampedIndex]
            : new DamageMultiplierPart { Mult = stage.Mult, Hits = stage.Hits };

        var partMult = multiplierOverride ?? activePart.Mult;
        var partHits = hitsOverride ?? activePart.Hits;
        var totals = BuffModel.FoldDrops(drops, drop => context.ScopeForOwner(drop));
        var (multZone, zoneMult) = BuffModel.SplitZoneFactors(drops, drop => context.ScopeForOwner(drop));

        var stats = new Dictionary<string, double>(panel.Panel, StringComparer.Ordinal);
        if (overrides is not null)
        {
            foreach (var (key, value) in overrides) stats[key] = value;
        }
        foreach (var (key, value) in totals)
        {
            stats[key] = stats.GetValueOrDefault(key) + value;
        }

        var usedElement = FirstNonEmpty(element, summary?.Element, source.Element);
        var attackerLevel = panel.Unit?.Level ?? 0;
        if (attackerLevel == 0 || !double.IsFinite(attackerLevel)) attackerLevel = 90;
        var result = DamageCalculator.Compute(AxisPanelStats.ToDamageStats(stats), new DamageOptions
        {
            Stage = new DamageStage { Mult = partMult, Hits = partHits },
            Reaction = AxisReactionTable.ByKey(entry.ReactionKey ?? summary?.ReactionKey),
            Element = usedElement,
            CritMode = string.IsNullOrEmpty(critMode) ? "avg" : critMode,
            AtkLevel = attackerLevel,
            ZoneMult = zoneMult,
            MultZone = multZone,
            Basis = basis,
        });

        return new AxisPartResult
        {
            PartIndex = partIndex,
            Element = usedElement,
            PerHit = result.PerHit,
            Total = result.Total,
            Hits = partHits == 0 || double.IsNaN(partHits) ? 1 : partHits,
            Mult = partMult,
            ScalingBasis = result.ScalingBasis,
        };
    }

    private static string EntryScalingBasis(AxisEntry? entry, string fallback)
        => DamageCalculator.NormaliseScalingBasis(
            entry?.ScalingBasis ?? entry?.Summary?.Stage?.Basis ?? fallback);

    private static string? FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(value => !string.IsNullOrEmpty(value));

    private static string? NullIfEmpty(string? value)
        => string.IsNullOrEmpty(value) ? null : value;
}
