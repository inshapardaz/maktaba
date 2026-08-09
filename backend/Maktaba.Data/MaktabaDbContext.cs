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
    public DbSet<BookFile> BookFiles => Set<BookFile>();
    public DbSet<Identifier> Identifiers => Set<Identifier>();

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

        modelBuilder.Entity<BookFile>()
            .HasOne(f => f.Book)
            .WithMany(b => b.Files)
            .HasForeignKey(f => f.BookId);

        modelBuilder.Entity<Identifier>()
            .HasOne(i => i.Book)
            .WithMany(b => b.Identifiers)
            .HasForeignKey(i => i.BookId);

        modelBuilder.Entity<Author>().HasIndex(a => a.Name);
        modelBuilder.Entity<Book>().HasIndex(b => b.SortTitle);
    }
}
