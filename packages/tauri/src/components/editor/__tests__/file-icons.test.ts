import { describe, it, expect } from "vitest";
import { getFileIcon } from "../file-icons";
import { File, FileCode, FileJson, FileText, FileImage, FileCog } from "lucide-react";

describe("getFileIcon", () => {
  it("returns FileCode for code files", () => {
    expect(getFileIcon("foo.ts")).toBe(FileCode);
    expect(getFileIcon("foo.tsx")).toBe(FileCode);
    expect(getFileIcon("foo.js")).toBe(FileCode);
    expect(getFileIcon("foo.jsx")).toBe(FileCode);
    expect(getFileIcon("foo.py")).toBe(FileCode);
    expect(getFileIcon("foo.rs")).toBe(FileCode);
    expect(getFileIcon("foo.go")).toBe(FileCode);
    expect(getFileIcon("foo.sh")).toBe(FileCode);
    expect(getFileIcon("foo.sql")).toBe(FileCode);
    expect(getFileIcon("foo.html")).toBe(FileCode);
    expect(getFileIcon("foo.css")).toBe(FileCode);
  });

  it("returns FileJson for json files", () => {
    expect(getFileIcon("foo.json")).toBe(FileJson);
    expect(getFileIcon("foo.jsonc")).toBe(FileJson);
  });

  it("returns FileText for markdown and text files", () => {
    expect(getFileIcon("foo.md")).toBe(FileText);
    expect(getFileIcon("foo.txt")).toBe(FileText);
  });

  it("returns FileImage for image files", () => {
    expect(getFileIcon("foo.png")).toBe(FileImage);
    expect(getFileIcon("foo.jpg")).toBe(FileImage);
    expect(getFileIcon("foo.svg")).toBe(FileImage);
  });

  it("returns FileCog for config files", () => {
    expect(getFileIcon("foo.toml")).toBe(FileCog);
    expect(getFileIcon("foo.yaml")).toBe(FileCog);
    expect(getFileIcon("foo.yml")).toBe(FileCog);
  });

  it("returns default File icon for unknown extensions", () => {
    expect(getFileIcon("foo.xyz")).toBe(File);
    expect(getFileIcon("Makefile")).toBe(File);
    expect(getFileIcon("foo")).toBe(File);
  });
});
