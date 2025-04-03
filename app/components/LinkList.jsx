"use client"; // Required for interactivity in Next.js

import { useState } from "react";
import { deleteLink } from "../services/linkService";
import toast from "react-hot-toast";

export default function LinkList({ links, loading, setLinks }) {
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (id, shortCode) => {
    if (!confirm(`Are you sure you want to delete ${shortCode}?`)) return;

    setDeletingId(id);
    try {
      await deleteLink(id);
      setLinks((prev) => prev.filter((link) => link.id !== id));
      toast.success("Link deleted successfully!");
    } catch (error) {
      console.log(error);
      toast.error("Failed to delete link");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mt-6 w-full max-w-md">
      <h2 className="text-lg font-semibold mb-2">Your Links</h2>
      {loading ? (
        <p>Loading links...</p>
      ) : links.length === 0 ? (
        <p>No links yet.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="p-3 bg-white shadow rounded flex justify-between items-center"
            >
              <div className="flex items-center space-x-4">
                <a
                  href={`/${link.short_code}`}
                  className="text-blue-600 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.short_code}
                </a>
                <span className="text-gray-600">{link.clicks} clicks</span>
              </div>

              <button
                onClick={() => handleDelete(link.id, link.short_code)}
                disabled={deletingId === link.id}
                className="text-red-500 hover:text-red-700 disabled:opacity-50"
                aria-label={`Delete ${link.short_code}`}
              >
                {deletingId === link.id ? (
                  "Deleting..."
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
