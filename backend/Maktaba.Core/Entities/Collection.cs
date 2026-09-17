namespace Maktaba.Core.Entities;

public class Collection
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    // Null for a top-level collection. Self-referencing, one level of nesting or many - a
    // collection can itself be another collection's parent (see CollectionEndpoints.cs's
    // PUT /{id}/parent for the cycle-prevention check that keeps this a DAG/tree rather than a
    // loop). DeleteBehavior.SetNull (MaktabaDbContext.OnModelCreating) means deleting a parent
    // promotes its children to top-level rather than deleting them too - collections are
    // user-organized buckets, not real folders, so silently cascading a delete through a whole
    // subtree would be surprising/destructive for what's meant to be a lightweight grouping.
    public int? ParentCollectionId { get; set; }
    public Collection? Parent { get; set; }
    public List<Collection> Children { get; set; } = [];

    public List<BookCollection> BookCollections { get; set; } = [];
}
