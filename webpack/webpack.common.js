const webpack = require("webpack");
const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const srcDir = path.join(__dirname, "..", "src");
const srcPagesDir = path.join(srcDir, "pages");

module.exports = {
    entry: {
      popup: path.join(srcPagesDir, 'popup.tsx'),
      options: path.join(srcPagesDir, 'options.tsx'),
      error_popup: path.join(srcPagesDir, 'error_popup.tsx'),
      background: path.join(srcPagesDir, 'background.ts'),
      content_script: path.join(srcPagesDir, 'content_script.ts'),
    },
    output: {
        path: path.join(__dirname, "../dist/js"),
        filename: "[name].js",
    },
    optimization: {
        splitChunks: {
            name: "vendor",
            chunks(chunk) {
              return chunk.name !== 'background';
            }
        },
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js"],
    },
    plugins: [
        new CopyPlugin({
            patterns: [{ from: ".", to: "../", context: "public" }],
            options: {},
        }),
    ],
};
