import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Locke',
  description: 'Review what your agents built locally — before it reaches origin/main.',
  lastUpdated: true,
  cleanUrls: true,

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Guide', link: '/guide/what-is-locke' },
      { text: 'Loops', link: '/guide/loops-quickstart' },
      { text: 'Reference', link: '/reference/mcp-tools' },
      { text: 'Contributing', link: '/contributing/architecture' },
      { text: 'v2.2', link: '/reference/changelog' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [
            { text: 'What is Locke?', link: '/guide/what-is-locke' },
            { text: 'Installation', link: '/guide/installation' },
          ],
        },
        {
          text: 'Loops',
          items: [
            { text: 'Loops quick-start', link: '/guide/loops-quickstart' },
            { text: 'Plan mode', link: '/guide/plan-mode' },
            { text: 'Building & review', link: '/guide/building-and-review' },
            { text: 'Work graph & dependencies', link: '/guide/work-graph' },
          ],
        },
        {
          text: 'Mission Control',
          items: [
            { text: 'Fleet overview', link: '/guide/mission-control' },
            { text: 'Resolve runs (v1.5)', link: '/guide/resolve-runs' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'MCP loop tools', link: '/reference/mcp-tools' },
            { text: 'locke.config.json', link: '/reference/config' },
            { text: 'Manifest & work graph', link: '/reference/manifest' },
            { text: 'Loop lifecycle', link: '/reference/loop-lifecycle' },
            { text: 'On-disk layout', link: '/reference/on-disk-layout' },
            { text: 'Changelog', link: '/reference/changelog' },
          ],
        },
      ],
      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Architecture', link: '/contributing/architecture' },
            { text: 'Building & releasing', link: '/contributing/building' },
          ],
        },
      ],
    },

    outline: { level: [2, 3] },

    search: { provider: 'local' },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/' },
    ],

    footer: {
      message: 'Locke — local-first agent review.',
      copyright: 'Documentation for Locke v2.2',
    },
  },
})
