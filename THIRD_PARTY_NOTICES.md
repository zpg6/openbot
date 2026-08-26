# Third-party notices

## Application framework

OpenBot uses React and React DOM `19.2.7`, Hono, Better Auth `1.7.1`, and Vite `8.2.1`. Each project is available under the MIT License. Vite is a build-time dependency; the production client bundle contains React and OpenBot code.

- React: https://react.dev/
- Hono: https://hono.dev/
- Better Auth: https://www.better-auth.com/
- Vite: https://vite.dev/

## DiceBear

OpenBot uses `@dicebear/core` version `10.5.0` to render Bot avatars locally. DiceBear core is copyright Florian Körner and available under the MIT License.

OpenBot uses the DiceBear Moods style version `10.5.0`. DiceBear created the style and released it under CC0 1.0.

- Renderer: https://github.com/dicebear/dicebear
- Style: https://www.dicebear.com/styles/moods/

OpenBot's generated Metorial provider catalog may include unmodified brand icons from theSVG. The theSVG code and tooling are MIT-licensed; individual marks retain their own licenses and trademark rights. Generated output records each icon source revision, digest, and reported license. Missing or ambiguous matches use OpenBot's generic integration mark.

- Project: https://thesvg.org/
- Legal: https://github.com/GLINCKER/thesvg/blob/main/LEGAL.md
- License index: https://www.dicebear.com/licenses/

OpenBot does not use the DiceBear HTTP API. The server generates each SVG from the pinned local style definition.
