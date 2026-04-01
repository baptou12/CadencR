import {
  File,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  FileCog,
  type LucideIcon,
} from "lucide-react";

const EXTENSION_MAP: Record<string, LucideIcon> = {
  // Code files
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  mjs: FileCode,
  cjs: FileCode,
  py: FileCode,
  rs: FileCode,
  go: FileCode,
  java: FileCode,
  c: FileCode,
  cpp: FileCode,
  h: FileCode,
  hpp: FileCode,
  cs: FileCode,
  rb: FileCode,
  php: FileCode,
  swift: FileCode,
  kt: FileCode,
  html: FileCode,
  css: FileCode,
  scss: FileCode,
  sass: FileCode,
  less: FileCode,
  vue: FileCode,
  svelte: FileCode,
  sh: FileCode,
  bash: FileCode,
  zsh: FileCode,
  fish: FileCode,
  sql: FileCode,
  // JSON
  json: FileJson,
  jsonc: FileJson,
  // Text / docs
  md: FileText,
  mdx: FileText,
  txt: FileText,
  rst: FileText,
  // Images
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  webp: FileImage,
  ico: FileImage,
  // Config
  toml: FileCog,
  yaml: FileCog,
  yml: FileCog,
  env: FileCog,
  lock: FileCog,
};

export function getFileIcon(fileName: string): LucideIcon {
  const ext = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  return EXTENSION_MAP[ext] ?? File;
}
