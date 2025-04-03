import { useState } from "react";
import { createLink } from "../services/linkService";
import toast from "react-hot-toast";

export default function LinkForm({ token, setLinks, loading, setLoading }) {
  const [originalUrl, setOriginalUrl] = useState("");
  const [shortCode, setShortCode] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    if (!originalUrl) {
      toast.error("Please enter a link you want to shorten!");
      setLoading(false);
      return;
    }

    if (!isValidUrl(originalUrl)) {
      toast.error("Please enter a valid URL!");
      setLoading(false);
      return;
    }

    if (!token) {
      toast.error("You must be logged in to create a link!");
      setLoading(false);
      return;
    }

    try {
      const newLink = await createLink({
        original_url: originalUrl,
        short_code: shortCode,
      });
      setLinks((prev) => [...prev, newLink.data]);
      setOriginalUrl("");
      setShortCode("");
      toast.success("Link shortened successfully!");
    } catch (error) {
      toast.error("Error creating link!");
    } finally {
      setLoading(false);
    }
  };

  const isValidUrl = (str) => {
    try {
      let formattedLink = str;
      if (!formattedLink.match(/^https?:\/\//i)) {
        formattedLink = "https://" + formattedLink;
      }
      new URL(formattedLink); // Check if the string is a valid URL
      return true;
    } catch (_) {
      return false;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <input
        className="p-2 border rounded"
        placeholder="Enter URL"
        value={originalUrl}
        onChange={(e) => setOriginalUrl(e.target.value)}
        required
      />
      <input
        className="p-2 border rounded"
        placeholder="Optional Short Name"
        value={shortCode}
        onChange={(e) => setShortCode(e.target.value)}
      />
      <button
        className="bg-[#FF8000] text-white px-4 py-2 rounded cursor-pointer"
        disabled={loading}
        type="submit"
      >
        {loading ? "Shortening..." : "Shorten"}
      </button>
    </form>
  );
}
