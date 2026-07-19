// The repo social preview shown when a GitHub link is unfurled. GitHub has no
// way to read this from the tree — it is uploaded by hand in repo settings —
// so it is generated here mainly to stop it drifting off-brand, which is
// exactly what happened to the version this replaced (it still carried the
// retired multi-color "agent arcs" mark on a Dracula palette).
import { socialSvg } from "../svg/social.mjs";

export const github = {
  name: "github",
  root: ".github/assets",
  assets: [
    { path: "social-preview.svg", kind: "svg", svg: socialSvg },
    {
      path: "social-preview.png",
      kind: "png",
      size: { width: 1280, height: 640 },
      svg: socialSvg,
    },
  ],
};
