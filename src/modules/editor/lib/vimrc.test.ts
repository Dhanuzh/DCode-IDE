import { describe, expect, it, vi } from "vitest";
import { applyVimrc, parseVimrc, type VimApi } from "./vimrc";

describe("parseVimrc", () => {
  it("parses mappings per mode, remapping or not", () => {
    const { commands, issues } = parseVimrc(
      ["inoremap jj <Esc>", "nmap <Space>w :w<CR>", "vnoremap < <gv"].join(
        "\n",
      ),
    );
    expect(issues).toEqual([]);
    expect(commands).toEqual([
      { kind: "map", lhs: "jj", rhs: "<Esc>", mode: "insert", remap: false },
      {
        kind: "map",
        lhs: "<Space>w",
        rhs: ":w<CR>",
        mode: "normal",
        remap: true,
      },
      { kind: "map", lhs: "<", rhs: "<gv", mode: "visual", remap: false },
    ]);
  });

  it("keeps spaces inside the target", () => {
    const { commands } = parseVimrc("nmap gb :buffer next<CR>");
    expect(commands[0]).toMatchObject({ rhs: ":buffer next<CR>" });
  });

  it("skips comments, blank lines and a leading colon", () => {
    const { commands, issues } = parseVimrc(
      '" a comment\n\n# another\n:set ignorecase\n',
    );
    expect(issues).toEqual([]);
    expect(commands).toEqual([
      { kind: "set", name: "ignorecase", value: true },
    ]);
  });

  it("handles set forms", () => {
    const { commands } = parseVimrc("set noignorecase\nset shiftwidth=2");
    expect(commands).toEqual([
      { kind: "set", name: "ignorecase", value: false },
      { kind: "set", name: "shiftwidth", value: "2" },
    ]);
  });

  it("parses unmap and mapclear", () => {
    const { commands } = parseVimrc("iunmap jj\nnmapclear");
    expect(commands).toEqual([
      { kind: "unmap", lhs: "jj", mode: "insert" },
      { kind: "mapclear", mode: "normal" },
    ]);
  });

  it("reports unusable lines with their line number", () => {
    const { commands, issues } = parseVimrc(
      "nmap\nset nosuchthing\nfrobnicate x\nset ignorecase",
    );
    expect(commands).toHaveLength(1);
    expect(issues).toEqual([
      { line: 1, text: "nmap", reason: "a mapping needs keys and a target" },
      {
        line: 2,
        text: "set nosuchthing",
        reason: 'unsupported option "nosuchthing"',
      },
      { line: 3, text: "frobnicate x", reason: 'unknown command "frobnicate"' },
    ]);
  });
});

describe("applyVimrc", () => {
  function fakeVim(): VimApi & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      map: (lhs, rhs, ctx) => calls.push(`map ${lhs} ${rhs} ${ctx}`),
      noremap: (lhs, rhs, ctx) => calls.push(`noremap ${lhs} ${rhs} ${ctx}`),
      unmap: (lhs, ctx) => calls.push(`unmap ${lhs} ${ctx}`),
      mapclear: (ctx) => calls.push(`mapclear ${ctx}`),
      setOption: (name, value) => calls.push(`set ${name} ${value}`),
    };
  }

  it("routes each command to the vim api", () => {
    const vim = fakeVim();
    const { commands } = parseVimrc(
      "inoremap jj <Esc>\nnmap x y\nvunmap <\nset ignorecase\nmapclear",
    );
    expect(applyVimrc(vim, commands).failures).toEqual([]);
    expect(vim.calls).toEqual([
      "noremap jj <Esc> insert",
      "map x y normal",
      "unmap < visual",
      "set ignorecase true",
      "mapclear undefined",
    ]);
  });

  it("collects failures instead of throwing", () => {
    const vim = fakeVim();
    vim.map = () => {
      throw new Error("bad mapping");
    };
    vim.setOption = vi.fn(() => new Error("bad option"));
    const { commands } = parseVimrc("nmap x y\nset ignorecase");
    expect(applyVimrc(vim, commands).failures).toEqual([
      "bad mapping",
      "bad option",
    ]);
  });
});
