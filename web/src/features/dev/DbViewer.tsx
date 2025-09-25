// web/src/features/dev/DbViewer.tsx
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/api";

const TABLES = ["projects", "threads", "uploads", "messages", "brief_items", "users"] as const;

export default function DbViewer() {
  const { auth } = useAuth();
  const [table, setTable] = useState<typeof TABLES[number]>("projects");
  const [rows, setRows] = useState<any[]>([]);
  const token = auth.token;

  useEffect(() => {
    if (!token) {
      setRows([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/${table}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          setRows([]);
          return;
        }
        const payload = await res.json();
        setRows(payload.items || []);
      } catch {
        setRows([]);
      }
    })();
  }, [table, token]);

  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-lg font-semibold">DB Viewer</h1>
      <select
        className="border rounded px-2 py-1"
        value={table}
        onChange={(event) => setTable(event.target.value as typeof TABLES[number])}
      >
        {TABLES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              {columns.map((key) => (
                <th key={key} className="px-2 py-1 text-left">
                  {key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="odd:bg-white even:bg-gray-50">
                {columns.map((key) => (
                  <td key={key} className="px-2 py-1">
                    {String(row[key])}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="px-2 py-2">No rows</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

