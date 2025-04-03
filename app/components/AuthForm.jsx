import { useState } from "react";
import { toast } from "react-hot-toast";
import { register, login } from "../services/authService";

export default function AuthForm({ authType, onAuthSuccess }) {
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    password_confirmation: "",
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      let res;
      if (authType === "register") {
        res = await register(form);
      } else {
        res = await login(form);
      }
      console.log(res);
      onAuthSuccess(res.data.token);
    } catch (error) {
      toast.error(error.response?.data?.message || "Authentication failed!");
    }

    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {authType === "register" && (
        <input
          className="p-2 border rounded"
          type="text"
          name="name"
          placeholder="Name"
          onChange={handleChange}
          required
        />
      )}
      <input
        className="p-2 border rounded"
        type="email"
        name="email"
        placeholder="Email"
        onChange={handleChange}
        required
      />
      <input
        className="p-2 border rounded"
        type="password"
        name="password"
        placeholder="Password"
        onChange={handleChange}
        required
      />
      {authType === "register" && (
        <input
          className="p-2 border rounded"
          type="password"
          name="password_confirmation"
          placeholder="Confirm Password"
          onChange={handleChange}
          required
        />
      )}
      <button className="bg-[#FF8000] text-white px-4 py-2 rounded cursor-pointer">
        {loading
          ? "Processing..."
          : authType === "register"
          ? "Register"
          : "Login"}
      </button>
    </form>
  );
}
