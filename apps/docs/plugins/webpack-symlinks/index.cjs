/**
 * Local Docusaurus plugin: disable webpack symlink resolution.
 *
 * The monorepo is installed with Bun, whose store layout
 * (`node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>` + symlinks) makes webpack
 * resolve the same module under many real paths when `resolve.symlinks` is left
 * on its default (`true`). That multiplies the module graph until the build
 * exhausts memory. Pinning `resolve.symlinks: false` keeps every dependency at a
 * single identity.
 */
module.exports = function webpackSymlinksPlugin() {
  return {
    name: 'webpack-symlinks',
    configureWebpack() {
      return {
        resolve: { symlinks: false },
      };
    },
  };
};
