import type { Theme } from "../types";

export const dcodeDefault: Theme = {
  id: "dcode-default",
  name: "DCode Default",
  description: "The default DCode-IDE look — clean glass over neutral surfaces.",
  editorTheme: { dark: "atomone", light: "atomone" },
  variants: {
    light: {},
    dark: {},
  },
};
