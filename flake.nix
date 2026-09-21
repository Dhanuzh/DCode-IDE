{
  description = "DCode - open-source lightweight cross-platform AI-native terminal (ADE)";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }: let
    forAllSystems = nixpkgs.lib.genAttrs [ "x86_64-linux" "x86_64-darwin" "aarch64-darwin" ];
  in {
    packages = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      dcode = pkgs.callPackage ./nix/package.nix { };
      default = self.packages.${system}.dcode;
    });

    nixosModules.dcode = { pkgs, ... }: {
      environment.systemPackages = [ self.packages.${pkgs.system}.dcode ];
    };

    darwinModules.dcode = { pkgs, ... }: {
      environment.systemPackages = [ self.packages.${pkgs.system}.dcode ];
    };
  };
}
