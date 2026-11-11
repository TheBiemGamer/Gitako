import * as path from 'node:path'
import * as s from 'superstruct'
import type { Configuration } from 'webpack'
const DashboardPlugin = require('webpack-dashboard/plugin')
const webpack = require('webpack')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin')
const Dotenv = require('dotenv-webpack')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')

const IN_PRODUCTION_MODE = process.env.NODE_ENV === 'production'

type Target = 'default' | 'firefox' | 'safari'

function createConfig({ envTarget }: { envTarget: Target }) {
  const outputPath = {
    default: path.resolve(__dirname, 'dist'),
    firefox: path.resolve(__dirname, 'dist-firefox'),
    safari: path.resolve(__dirname, 'Safari/Gitako/Gitako Extension/Resources'),
  }[envTarget]

  const plugins = [
    new DashboardPlugin(),
    new CleanWebpackPlugin(),
    new CopyWebpackPlugin({
      patterns: [
        (() => {
          const sManifest = s.type({
            version: s.optional(s.string()),
            description: s.optional(s.string()),
            author: s.optional(s.string()),
            homepage_url: s.optional(s.string()),
            manifest_version: s.number(),
            background: s.type({
              scripts: s.optional(s.array(s.string())),
              service_worker: s.string(),
            }),
            web_accessible_resources: s.array(
              s.type({
                resources: s.array(s.string()),
                matches: s.array(s.string()),
              }),
            ),
          })
          return {
            from: './src/manifest.json',
            to: 'manifest.json',
            transform(content: string) {
              const {
                version,
                description,
                author,
                homepage: homepage_url,
              } = require('./package.json')
              const manifest = JSON.parse(content)
              s.assert(manifest, sManifest)

              manifest.version = version
              manifest.description = description
              manifest.author = author
              manifest.homepage_url = homepage_url

              switch (envTarget) {
                case 'safari': {
                  // Disable custom domains for Safari
                  Reflect.deleteProperty(manifest, 'optional_permissions')
                  Reflect.deleteProperty(manifest, 'background')
                  break
                }
                case 'firefox': {
                  manifest.manifest_version = 3
                  // Firefox does not support service worker
                  Reflect.set(manifest.background, 'scripts', [manifest.background.service_worker])
                  Reflect.set(manifest, 'browser_specific_settings', {
                    gecko: { id: '{983bd86b-9d6f-4394-92b8-63d844c4ce4c}' },
                  })
                  Reflect.deleteProperty(manifest.background, 'service_worker')
                  break
                }
              }

              if (!IN_PRODUCTION_MODE) {
                // enable source mapping while developing
                manifest.web_accessible_resources.push({
                  resources: ['*.map'],
                  matches: ['*://*/*'],
                })
              }
              return JSON.stringify(manifest)
            },
          }
        })(),
        {
          from: './src/assets/icons/*',
          to: 'icons/[name][ext]',
        },
        {
          from: './vscode-icons/icons/*',
          to: 'icons/vscode/[name][ext]',
        },
        {
          from: 'node_modules/webextension-polyfill/dist/browser-polyfill.js',
          to: 'browser-polyfill.js',
        },
        {
          from: './src/firefox-shim.js',
          to: 'firefox-shim.js',
        },
        {
          from: './src/options.html',
          to: 'options.html',
        },
      ],
    }),
    new ForkTsCheckerWebpackPlugin(),
    new Dotenv(),
    new MiniCssExtractPlugin(),
    new webpack.DefinePlugin({
      'process.env.VERSION': JSON.stringify(process.env.VERSION),
    }),
  ]

  const analyze = process.env.ANALYZE !== undefined
  if (analyze) {
    const webpackBundleAnalyzer = require('webpack-bundle-analyzer')
    plugins.push(new webpackBundleAnalyzer.BundleAnalyzerPlugin())
    console.log(`BundleAnalyzerPlugin added`)
  }

  const srcPath = path.resolve(__dirname, 'src')

  const webpackConfig: Configuration = {
    entry: {
      content: './src/content.tsx',
      early: './src/early.ts',
      options: './src/options.ts',
      background: './src/background.ts',
    },
    devtool: IN_PRODUCTION_MODE ? 'source-map' : 'inline-source-map',
    mode: IN_PRODUCTION_MODE ? 'production' : 'development',
    output: {
      path: outputPath,
      filename: '[name].js',
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
      modules: [srcPath, 'node_modules'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          loader: 'swc-loader',
          include: [srcPath],
          exclude: /node_modules/,
          sideEffects: false,
        },
        {
          test: /\.[cm]?js$/,
          loader: 'swc-loader',
          // Transpile as least files under node_modules
          include: /node_modules\/(webext-.*|superstruct)\/.*\.[cm]?js$/,
          options: {
            jsc: {
              parser: {
                syntax: 'ecmascript',
              },
              target: 'es2022',
            },
          },
        },
        {
          test: /\.scss$/,
          loader: MiniCssExtractPlugin.loader,
          include: [srcPath],
        },
        {
          test: /\.scss$/,
          loader: 'css-loader',
          include: [srcPath],
        },
        {
          test: /\.scss$/,
          loader: 'sass-loader',
          include: [srcPath],
        },
        {
          test: /\.svg$/,
          resourceQuery: /inline/,
          loader: 'url-loader',
        },
        {
          test: /\.csv$/,
          loader: 'raw-loader',
        },
        {
          test: /\.json$/,
          loader: 'json-loader',
          include: [srcPath],
        },
        {
          test: /\.png$/,
          loader: 'url-loader',
          include: [srcPath],
        },
      ],
    },
    plugins,
  }

  return webpackConfig
}

const gitakoTarget = process.env.GITAKO_TARGET ?? 'default'
const enabledTargets = (['default', 'firefox', 'safari'] as Target[]).filter(
  target => !gitakoTarget || gitakoTarget === target,
)
const configs = enabledTargets.map(envTarget => createConfig({ envTarget }))

// Enable parallelism for faster build
// https://webpack.js.org/configuration/configuration-types/#parallelism
Object.assign(configs, {
  parallelism: true,
})

module.exports = configs
