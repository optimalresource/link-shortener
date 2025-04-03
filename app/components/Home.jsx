"use client";

import { useEffect, useState } from "react";
import { createLink, getLinks } from "../services/linkService";
import { login, register, logout } from "../services/authService";
import toast, { Toaster } from "react-hot-toast";
import LinkForm from "./LinkForm";
import LinkList from "./LinkList";
import AuthForm from "./AuthForm";

export default function Home() {
  const [token, setToken] = useState(null);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem("hclink_token");
    if (storedToken) {
      setToken(storedToken);
      fetchLinks(storedToken);
    }
  }, []);

  const fetchLinks = async (token) => {
    // setLoading(true);
    try {
      const res = await getLinks();
      setLinks(res.data);
    } catch (error) {
      toast.error("Error fetching links!");
    } finally {
      setLoading(false);
    }
  };

  const fixNewLists = (id) => {
    setLinks((prev) => prev.filter((link) => link.id !== id));
  };

  const onAuthSuccess = async (token) => {
    setToken(token);
    localStorage.setItem("hclink_token", token);
    await fetchLinks(token);
    toast.success("Logged in successfully!");
    setShowRegister(false);
    setShowLogin(false);
  };

  const handleLogout = async () => {
    try {
      await logout(token);
      toast.success("Logged out successfully!");
    } catch (error) {
      toast.error("Error logging out!");
    } finally {
      setToken(null);
      localStorage.removeItem("hclink_token");
      setLinks([]);
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
        <LinkForm
          token={token}
          setLinks={setLinks}
          loading={loading}
          setLoading={setLoading}
        />
      )}

      {showLogin && (
        <AuthForm
          isLogin={true}
          setToken={setToken}
          fetchLinks={fetchLinks}
          onAuthSuccess={onAuthSuccess}
        />
      )}
      {showRegister && (
        <AuthForm
          isLogin={false}
          setToken={setToken}
          fetchLinks={fetchLinks}
          authType="register"
          onAuthSuccess={onAuthSuccess}
        />
      )}

      {token ? (
        <div className="text-gray-600 flex justify-center items-center gap-3 my-4">
          <button
            onClick={handleLogout}
            className="bg-red-500 text-white px-4 py-2 rounded cursor-pointer"
          >
            Logout
          </button>{" "}
          be safe out there
        </div>
      ) : (
        <div className="text-gray-600 flex justify-center items-center gap-3 my-4">
          <button
            onClick={() => {
              setShowLogin(!showLogin);
              setShowRegister(false);
            }}
            className="bg-gray-700 text-white px-4 py-2 rounded cursor-pointer"
          >
            {showLogin ? "Back" : "Login"}
          </button>
          <button
            onClick={() => {
              setShowRegister(!showRegister);
              setShowLogin(false);
            }}
            className="bg-gray-900 text-white px-4 py-2 rounded cursor-pointer"
          >
            {showRegister ? "Back" : "Register"}
          </button>
        </div>
      )}

      {token && <LinkList links={links} setLinks={setLinks} />}
    </div>
  );
}
