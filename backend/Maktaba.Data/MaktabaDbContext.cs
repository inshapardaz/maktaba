using Maktaba.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data;

public class MaktabaDbContext(DbContextOptions<MaktabaDbContext> options) : DbContext(options)
{
    public DbSet<Book> Books => Set<Book>();
    public DbSet<Author> Authors => Set<Author>();
    public DbSet<BookAuthor> BookAuthors => Set<BookAuthor>();
    public DbSet<Series> Series => Set<Series>();
    public DbSet<BookSeries> BookSeries => Set<BookSeries>();
    public DbSet<Tag> Tags => Set<Tag>();
    public DbSet<BookTag> BookTags => Set<BookTag>();
    public DbSet<Collection> Collections => Set<Collection>();
    public DbSet<Periodical> Periodicals => Set<Periodical>();
    public DbSet<BookCollection> BookCollections => Set<BookCollection>();
    public DbSet<BookFile> BookFiles => Set<BookFile>();
    public DbSet<Identifier> Identifiers => Set<Identifier>();
    public DbSet<Bookmark> Bookmarks => Set<Bookmark>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<ReadingProgress> ReadingProgress => Set<ReadingProgress>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<BookAuthor>(e =>
        {
            e.HasKey(ba => new { ba.BookId, ba.AuthorId });
            e.HasOne(ba => ba.Book).WithMany(b => b.BookAuthors).HasForeignKey(ba => ba.BookId);
            e.HasOne(ba => ba.Author).WithMany(a => a.BookAuthors).HasForeignKey(ba => ba.AuthorId);
        });

        modelBuilder.Entity<BookSeries>(e =>
        {
            e.HasKey(bs => new { bs.BookId, bs.SeriesId });
            e.HasOne(bs => bs.Book).WithMany(b => b.BookSeries).HasForeignKey(bs => bs.BookId);
            e.HasOne(bs => bs.Series).WithMany(s => s.BookSeries).HasForeignKey(bs => bs.SeriesId);
        });

        modelBuilder.Entity<BookTag>(e =>
        {
            e.HasKey(bt => new { bt.BookId, bt.TagId });
            e.HasOne(bt => bt.Book).WithMany(b => b.BookTags).HasForeignKey(bt => bt.BookId);
            e.HasOne(bt => bt.Tag).WithMany(t => t.BookTags).HasForeignKey(bt => bt.TagId);
        });

        modelBuilder.Entity<BookCollection>(e =>
        {
            e.HasKey(bc => new { bc.BookId, bc.CollectionId });
            e.HasOne(bc => bc.Book).WithMany(b => b.BookCollections).HasForeignKey(bc => bc.BookId);
            e.HasOne(bc => bc.Collection).WithMany(c => c.BookCollections).HasForeignKey(bc => bc.CollectionId);
        });

        modelBuilder.Entity<BookFile>()
            .HasOne(f => f.Book)
            .WithMany(b => b.Files)
            .HasForeignKey(f => f.BookId);

        modelBuilder.Entity<Book>()
            .HasOne(b => b.Periodical)
            .WithMany(p => p.Issues)
            .HasForeignKey(b => b.PeriodicalId)
            .IsRequired(false);

        modelBuilder.Entity<Identifier>()
            .HasOne(i => i.Book)
            .WithMany(b => b.Identifiers)
            .HasForeignKey(i => i.BookId);

        modelBuilder.Entity<Bookmark>(e =>
        {
            e.HasOne(bm => bm.Book).WithMany().HasForeignKey(bm => bm.BookId);
            e.HasIndex(bm => bm.ClientId).IsUnique();
        });

        modelBuilder.Entity<Note>(e =>
        {
            e.HasOne(n => n.Book).WithMany().HasForeignKey(n => n.BookId);
            e.HasIndex(n => n.ClientId).IsUnique();
        });

        modelBuilder.Entity<ReadingProgress>(e =>
        {
            e.HasKey(rp => rp.BookId);
            e.HasOne(rp => rp.Book).WithOne().HasForeignKey<ReadingProgress>(rp => rp.BookId);
        });

        modelBuilder.Entity<Author>().HasIndex(a => a.Name);
        modelBuilder.Entity<Book>().HasIndex(b => b.SortTitle);
        modelBuilder.Entity<Periodical>().HasIndex(p => p.Name);
    }
}
