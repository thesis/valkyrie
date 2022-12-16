// Description:
//   Lifted from typescript-require-hook package. Need it to use our version of
//   TS. Allows loading TypeScript files.

// Kill eslint as our rules are built for TypeScript, and this file bootstraps
// TypeScript loading.
/* eslint-disable */

const ts = require("typescript")
const fs = require("fs")

function compile(filename) {
  return ts.transpile(`${fs.readFileSync(filename)}`, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
    jsx: "react",
  })
}

require.extensions[".ts"] = function (m, filename) {
  if (filename.indexOf("node_modules") > -1) {
    m._compile(`${fs.readFileSync(filename)}`, filename)
  } else {
    m._compile(compile(filename), filename)
  }
}

require.extensions[".tsx"] = require.extensions[".ts"]

module.exports = function () {
  return "success"
}
