import { useState } from "react";
import { toast } from "react-hot-toast";

export default function ShortenerForm({ onCreate }) {
  const [originalUrl, setOriginalUrl] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    if (!originalUrl || !shortCode) {
      toast.error("Please enter a URL and a short name!");
      setLoading(false);
      return;
    }

    await onCreate(originalUrl, shortCode);
    setOriginalUrl("");
    setShortCode("");
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <input
        placeholder="Enter URL"
        value={originalUrl}
        onChange={(e) => setOriginalUrl(e.target.value)}
      />
      <input
        placeholder="Optional Short Name"
        value={shortCode}
        onChange={(e) => setShortCode(e.target.value)}
      />
      <button
        className="bg-[#FF8000] text-white px-4 py-2 rounded cursor-pointer"
        disabled={loading}
      >
        {loading ? "Shortening..." : "Shorten"}
      </button>
    </form>
  );
}
