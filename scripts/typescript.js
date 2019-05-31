// Description:
//   Lifted from typescript-require-hook package. Need it to use our version of
//   TS. Allows loading TypeScript files.

var ts = require("typescript");
var fs = require("fs");

function compile(filename) {
  return ts.transpile("" + fs.readFileSync(filename), {
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS
  });
}

require.extensions[".ts"] = function(m, filename) {
  if (filename.indexOf("node_modules") > -1) {
    m._compile("" + fs.readFileSync(filename), filename);
  } else {
    m._compile(compile(filename), filename);
  }
};

module.exports = function() {
  return "success";
};
