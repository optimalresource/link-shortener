"use client";

import { useState, useEffect } from "react";
import { createLink, getLinks } from "../services/linkService";
import toast, { Toaster } from "react-hot-toast";
import { register } from "../services/authService";

export default function Home() {
  const [originalUrl, setOriginalUrl] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [token, setToken] = useState(null);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    password_confirmation: "",
  });
  const [suggestion, setSuggestion] = useState("");

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

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const checkName = async () => {
    if (!shortCode) return;

    try {
      const res = await fetch(`/api/check-name/${shortCode}`);
      if (res.status === 409) {
        const data = await res.json();
        setSuggestion(data.suggestion);
        toast.error("Name already taken! Try " + data.suggestion);
      } else {
        setSuggestion("");
      }
    } catch (error) {
      toast.error("Error checking name");
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();

    if (form.password !== form.password_confirmation) {
      toast.error("Passwords do not match!");
      return;
    }

    try {
      const res = await register(form);
      localStorage.setItem("token", res.data.token);
      toast.success("Registration successful!");
      setToken(res.data.token);
    } catch (error) {
      toast.error(error.response?.data?.message || "Registration failed!");
    }
  };

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

    if (!originalUrl || !shortCode) {
      toast.error("Please enter a name and URL!");
      return;
    }

    try {
      await createLink({ original_url: originalUrl, shortCode });
      setLinks([...links, { original_url: originalUrl, shortCode, clicks: 0 }]);
      setOriginalUrl("");
      toast.success("Link shortened successfully!");
      setShortCode("");
    } catch (error) {
      toast.error("Error creating link. Try again!");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50">
      <h1 className="text-3xl font-bold mb-4">
        {showRegister
          ? "Shortener Sign Up"
          : showLogin
          ? "Shortener Login"
          : "Link Shortener"}
      </h1>

      {!showLogin && !showRegister && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            className="p-2 border rounded"
            placeholder="Enter URL"
            value={originalUrl}
            onChange={(e) => setOriginalUrl(e.target.value)}
          />

          <div className="flex items-center">
            <input
              className="p-2 border rounded"
              placeholder="Optional Short Name"
              value={name}
              onChange={(e) => setShortCode(e.target.value)}
            />
            {suggestion && (
              <button
                onClick={() => setShortCode(suggestion)}
                className="ml-2 text-blue-500 underline"
              >
                Use {suggestion}
              </button>
            )}
          </div>
          <button className="bg-[#FF8000] text-white px-4 py-2 rounded cursor-pointer">
            Shorten
          </button>
        </form>
      )}

      {showLogin && (
        <form onSubmit={handleLogin} className="flex flex-col gap-2">
          <input
            className="p-2 border rounded"
            placeholder="Enter email"
            value={originalUrl}
            onChange={(e) => setOriginalUrl(e.target.value)}
          />
          <input
            className="p-2 border rounded"
            placeholder="Enter password"
            value={shortCode}
            onChange={(e) => setShortCode(e.target.value)}
          />
          <button className="bg-[#FF8000] text-white px-4 py-2 rounded cursor-pointer">
            Login
          </button>
        </form>
      )}

      {showRegister && (
        <div className="flex flex-col items-center">
          <Toaster position="top-right" />
          <form onSubmit={handleRegister} className="flex flex-col gap-2">
            <input
              type="text"
              className="p-2 border rounded"
              placeholder="Name"
              name="name"
              onChange={handleChange}
              required
            />
            <input
              type="email"
              className="p-2 border rounded"
              name="email"
              placeholder="Email"
              onChange={handleChange}
              required
            />
            <input
              type="password"
              className="p-2 border rounded"
              name="password"
              placeholder="Password"
              onChange={handleChange}
              required
            />
            <input
              type="password"
              className="p-2 border rounded"
              name="password_confirmation"
              placeholder="Confirm Password"
              onChange={handleChange}
              required
            />
            <button
              className="bg-[#FF8000] text-white px-4 py-2 rounded cursor-pointer"
              type="submit"
            >
              Register
            </button>
          </form>
        </div>
      )}

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
      {!token && !showLogin ? (
        <div className="text-gray-600 flex justify-center items-center gap-3 my-4">
          <button
            onClick={() => {
              setShowLogin(true);
              setShowRegister(false);
            }}
            className="bg-gray-700 text-white px-4 py-2 rounded cursor-pointer"
          >
            Login
          </button>{" "}
          <span>for a smooth ride</span>
        </div>
      ) : (
        <div className="text-gray-600 flex justify-center items-center gap-3 my-4">
          <button
            onClick={() => {
              setShowRegister(true);
              setShowLogin(false);
            }}
            className="bg-gray-900 text-white px-4 py-2 rounded cursor-pointer"
          >
            Register
          </button>{" "}
          <span>as a newbie!</span>
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
                  href={`http://127.0.0.1:8000/api/links/${link.short_code}`}
                  target="_blank"
                  className="text-blue-600 underline"
                >
                  bit.link/{link.short_code}
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
