import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "../trpc";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const settingsList = trpc.settings.list.useQuery();
  const setSetting = trpc.settings.set.useMutation({
    onSuccess: () => {
      settingsList.refetch();
      setKey("");
      setValue("");
    },
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      <div className="flex gap-2 mb-6">
        <input
          className="border rounded px-3 py-1.5 text-sm"
          placeholder="Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <input
          className="border rounded px-3 py-1.5 text-sm"
          placeholder="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="bg-primary text-primary-foreground px-4 py-1.5 rounded text-sm"
          onClick={() => {
            if (key && value) {
              setSetting.mutate({ key, value });
            }
          }}
        >
          Save
        </button>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Stored Settings</h2>
        {settingsList.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No settings stored yet.</p>
        )}
        {settingsList.data?.map((item) => (
          <div key={item.key} className="flex gap-2 text-sm">
            <span className="font-mono font-medium">{item.key}</span>
            <span className="text-muted-foreground">=</span>
            <span>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
