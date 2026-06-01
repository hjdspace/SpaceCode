import { useState } from "react";

export default function App() {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState("");

  const add = () => {
    if (!input.trim()) return;
    setTodos([...todos, { id: Date.now(), text: input.trim(), done: false }]);
    setInput("");
  };

  const toggle = (id) =>
    setTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  const remove = (id) => setTodos(todos.filter((t) => t.id !== id));

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Todo</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="添加待办..."
          style={{ flex: 1, padding: "6px 10px", fontSize: 14 }}
        />
        <button onClick={add} style={{ padding: "6px 14px" }}>添加</button>
      </div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {todos.map((t) => (
          <li
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 0",
              borderBottom: "1px solid #eee",
            }}
          >
            <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} />
            <span style={{ flex: 1, textDecoration: t.done ? "line-through" : "none", color: t.done ? "#999" : "#000" }}>
              {t.text}
            </span>
            <button onClick={() => remove(t.id)} style={{ border: "none", background: "none", color: "#e11", cursor: "pointer", fontSize: 16 }}>x</button>
          </li>
        ))}
      </ul>
      {todos.length === 0 && <p style={{ color: "#999" }}>暂无待办，输入内容添加。</p>}
    </div>
  );
}
