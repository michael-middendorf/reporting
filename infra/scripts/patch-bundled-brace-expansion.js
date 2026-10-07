"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const source = path.join(root, "node_modules", "brace-expansion");
const dest = path.join(
  root,
  "node_modules",
  "aws-cdk-lib",
  "node_modules",
  "brace-expansion",
);

if (!fs.existsSync(source) || !fs.existsSync(dest)) {
  console.error("patch-bundled-brace-expansion: source or destination is missing");
  console.error("source=" + source);
  console.error("dest=" + dest);
  process.exit(1);
}

fs.cpSync(source, dest, { recursive: true, force: true });

const installed = JSON.parse(
  fs.readFileSync(path.join(dest, "package.json"), "utf8"),
);

if (installed.version !== "5.0.12") {
  console.error(
    "patch-bundled-brace-expansion: destination version is " +
      installed.version +
      ", expected 5.0.12",
  );
  process.exit(1);
}
