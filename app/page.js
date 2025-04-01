"use client";

import { useState, useEffect } from "react";
import { createLink, getLinks } from "../services/linkService";
import toast, { Toaster } from "react-hot-toast";

export default function Home() {
  const [originalUrl, setOriginalUrl] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState(null);
  const [links, setLinks] = useState([]);

  useEffect(() => {
    const storedToken = localStorage.getItem("hclink_token");
    if (storedToken) {
      setToken(storedToken);
      getLinks(storedToken).then((res) => setLinks(res.data));
    }
  }, []);

  useEffect(() => {
    getLinks().then((res) => setLinks(res.data));
  }, []);

  const handleLogin = async () => {
    try {
      const res = await login({
        email: "test@example.com",
        password: "password",
      });
      localStorage.setItem("hclink_token", res.data.token);
      setToken(res.data.token);
      getLinks(res.data.token).then((res) => setLinks(res.data));
      toast.success("Logged in successfully!");
    } catch (error) {
      toast.error("Login failed! Check credentials.");
    }
  };

  const handleLogout = async () => {
    await logout(token);
    localStorage.removeItem("hclink_token");
    setToken(null);
    setLinks([]);
    toast.success("Logged out successfully!");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      toast.error("You must be logged in to create a link!");
      return;
    }

    if (!originalUrl || !name) {
      toast.error("Please enter a name and URL!");
      return;
    }

    try {
      await createLink({ original_url: originalUrl, name });
      setLinks([...links, { original_url: originalUrl, name, clicks: 0 }]);
      setOriginalUrl("");
      toast.success("Link shortened successfully!");
      setName("");
    } catch (error) {
      toast.error("Error creating link. Try again!");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50">
      <h1 className="text-3xl font-bold mb-4">Link Shortener</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          className="p-2 border rounded"
          placeholder="Enter URL"
          value={originalUrl}
          onChange={(e) => setOriginalUrl(e.target.value)}
        />
        <input
          className="p-2 border rounded"
          placeholder="Short Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="bg-gray-700 text-white px-4 py-2 rounded cursor-pointer">
          Shorten
        </button>
      </form>

      {/* {!token && <div>--Login to begin--</div>} */}
      {token && (
        <div className="text-gray-600 flex justify-center items-center gap-3 my-4">
          <button
            onClick={handleLogout}
            className="bg-red-500 text-white px-4 py-2 rounded cursor-pointer"
          >
            Logout
          </button>{" "}
          be safe out there
        </div>
      )}
      {!token && (
        <div className="text-gray-600 flex justify-center items-center gap-3 my-4">
          <button
            onClick={handleLogin}
            className="bg-[#FF8000] text-white px-4 py-2 rounded cursor-pointer"
          >
            Login
          </button>{" "}
          <span>for a smooth ride</span>
        </div>
      )}

      {token && (
        <div className="mt-6 w-full max-w-md">
          <h2 className="text-lg font-semibold mb-2">Your Links</h2>
          <ul className="space-y-2">
            {links.map((link, index) => (
              <li
                key={index}
                className="p-3 bg-white shadow rounded flex justify-between items-center"
              >
                <a
                  href={`http://127.0.0.1:8000/api/links/${link.name}`}
                  target="_blank"
                  className="text-blue-600 underline"
                >
                  bit.link/{link.name}
                </a>
                <span className="text-gray-600">{link.clicks} clicks</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
