using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

/// <summary>Case-insensitive find-or-create lookups shared by import and metadata editing.</summary>
internal static class EntityResolvers
{
    public static async Task<List<Author>> ResolveAuthorsAsync(
        MaktabaDbContext db, IReadOnlyList<string> authorNames, CancellationToken ct)
    {
        var authors = new List<Author>();

        foreach (var name in authorNames)
        {
            var trimmed = name.Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            var existing = await db.Authors.FirstOrDefaultAsync(a => a.Name.ToLower() == trimmed.ToLower(), ct);
            if (existing is not null)
            {
                authors.Add(existing);
                continue;
            }

            // Explicitly tracked as Added here rather than left to be discovered via graph cascade from
            // the new BookAuthor row that will reference it - EF Core doesn't reliably cascade-insert a
            // brand-new principal reached only through a join entity's reference navigation.
            var created = new Author { Name = trimmed, SortName = TitleSorting.ComputeAuthorSortName(trimmed) };
            db.Authors.Add(created);
            authors.Add(created);
        }

        return authors;
    }

    public static async Task<Series?> ResolveSeriesAsync(
        MaktabaDbContext db, string? seriesName, CancellationToken ct)
    {
        var trimmed = seriesName?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        var existing = await db.Series.FirstOrDefaultAsync(s => s.Name.ToLower() == trimmed.ToLower(), ct);
        if (existing is not null)
        {
            return existing;
        }

        var created = new Series { Name = trimmed };
        db.Series.Add(created);
        return created;
    }

    public static async Task<List<Tag>> ResolveTagsAsync(
        MaktabaDbContext db, IReadOnlyList<string> tagNames, CancellationToken ct)
    {
        var tags = new List<Tag>();

        foreach (var name in tagNames)
        {
            var trimmed = name.Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            var existing = await db.Tags.FirstOrDefaultAsync(t => t.Name.ToLower() == trimmed.ToLower(), ct);
            if (existing is not null)
            {
                tags.Add(existing);
                continue;
            }

            var created = new Tag { Name = trimmed };
            db.Tags.Add(created);
            tags.Add(created);
        }

        return tags;
    }
}
