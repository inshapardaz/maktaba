import type { BookSummary } from "../api";

interface BookListProps {
  books: BookSummary[];
  onSelect: (id: string) => void;
}

export function BookList({ books, onSelect }: BookListProps) {
  return (
    <div className="book-list-scroll">
      <table className="book-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Author</th>
            <th>Rating</th>
            <th>Date added</th>
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
            <tr key={book.id} onClick={() => onSelect(book.id)}>
              <td>{book.title}</td>
              <td>{book.authors.join(", ") || "Unknown author"}</td>
              <td>
                {"★".repeat(book.rating)}
                {"☆".repeat(5 - book.rating)}
              </td>
              <td>{new Date(book.dateAdded).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
