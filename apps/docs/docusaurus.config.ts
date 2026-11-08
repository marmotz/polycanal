import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

const GITHUB_REPO = 'https://github.com/marmotz/polycanal';

/** Packages documented in the generated API reference. */
const API_PACKAGES = ['core', 'rest', 'angular', 'zod', 'codegen', 'openapi', 'nest', 'express', 'cli'];

const config: Config = {
  title: 'Polycanal',
  tagline: 'A typed, transport-agnostic client in front of an existing back end.',
  favicon: 'img/favicon.svg',

  // GitHub Pages project site. Change `url` and `baseUrl` when a custom domain is set.
  url: 'https://marmotz.github.io',
  baseUrl: '/polycanal/',

  organizationName: 'marmotz',
  projectName: 'polycanal',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',

  // English is the default locale (served at the root), French is served under /fr/. Untranslated pages (the
  // generated API reference) fall back to English.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
    localeConfigs: {
      en: { label: 'English', htmlLang: 'en' },
      fr: { label: 'Français', htmlLang: 'fr' },
    },
  },

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: `${GITHUB_REPO}/tree/develop/apps/docs/`,
          // The working copy is published as "next" until the first release. Cut a version with
          // `bun run --filter @polycanal/docs version <x.y.z>`: it is frozen under versioned_docs/ and becomes the
          // default, while "next" keeps following the develop branch.
          lastVersion: 'current',
          versions: {
            current: { label: 'next', banner: 'none' },
          },
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    './plugins/webpack-symlinks/index.cjs',
    [
      'docusaurus-plugin-typedoc',
      {
        // Generated API reference, regenerated on every build for "next" (docs/api/ is git-ignored). Versioning the
        // docs freezes a copy under versioned_docs/, which is committed.
        entryPointStrategy: 'packages',
        entryPoints: API_PACKAGES.map((name) => `../../packages/${name}`),
        out: 'docs/api',
        readme: 'none',
        hidePageHeader: true,
        hideBreadcrumbs: true,
        useCodeBlocks: true,
        expandObjects: true,
        parametersFormat: 'table',
        // Missing TSDoc on a public export is a warning, not a build failure.
        validation: {
          notDocumented: true,
          invalidLink: true,
          notExported: false,
        },
        treatWarningsAsErrors: false,
        sidebar: {
          autoConfiguration: true,
          pretty: true,
        },
      },
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        // Self-contained local search, no external service.
        hashed: true,
        indexDocs: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        language: ['en', 'fr'],
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'Polycanal',
      logo: {
        alt: 'Polycanal',
        src: 'img/favicon.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'guide',
          position: 'left',
          label: 'Docs',
        },
        {
          // Shown once there is more than one version (after the first `docs:version`).
          type: 'docsVersionDropdown',
          position: 'right',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
        {
          href: GITHUB_REPO,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Quick start', to: '/getting-started/quick-start' },
            { label: 'Contracts', to: '/guides/contracts' },
            { label: 'Code generation', to: '/guides/code-generation' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: GITHUB_REPO },
            { label: 'Issues', href: `${GITHUB_REPO}/issues` },
            { label: 'Specification', href: `${GITHUB_REPO}/blob/develop/docs/specs.md` },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Polycanal contributors. MIT License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
