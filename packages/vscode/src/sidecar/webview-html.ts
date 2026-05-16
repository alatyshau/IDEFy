// Builds the WebView HTML for the ASCII custom editor.
//
// Hard constraints from packages/vscode/spec/UI.md §WebView security:
//   - default-src 'none'
//   - script-src nonce
//   - style-src webview.cspSource + 'unsafe-inline'
//   - img-src webview.cspSource data: (for PNG export)
//   - no eval / Function / setTimeout(string)
//   - content set via textContent only — never innerHTML
//
// Content + tokens contract:
//   The host computes `(offset, length, role)[]` tokens with the same
//   lexical scanner used for the DSL (see `ascii-tokens.ts`) and ships them
//   alongside the raw text. The WebView builds DOM by walking the text and
//   wrapping each token range in `<span class="role-X">`. PNG export reads
//   per-span computed `color` and renders the canvas segment-by-segment so
//   the image matches what the user sees on screen.
//
// Refresh: `{ kind: "refresh", payload: { content, tokens } }`
// Error:   `{ kind: "error",   payload: { message } }`

export type WebviewTokenRole = "I" | "O" | "C" | "M" | "X" | "T" | "A";

export interface WebviewToken {
    readonly offset: number;
    readonly length: number;
    readonly role: WebviewTokenRole;
}

export interface WebviewHtmlOptions {
    readonly cspSource: string;
    readonly nonce: string;
    readonly initialContent: string;
    readonly initialTokens: readonly WebviewToken[];
    readonly initialError?: string;
}

export function buildAsciiViewerHtml(opts: WebviewHtmlOptions): string {
    const { cspSource, nonce, initialContent, initialTokens, initialError } = opts;
    const csp = [
        "default-src 'none'",
        `style-src ${cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
        `img-src ${cspSource} data:`,
    ].join("; ");

    const initialContentJson = jsonForInlineScript(initialContent);
    const initialTokensJson = jsonForInlineScript(JSON.stringify(initialTokens));
    const initialErrorJson = jsonForInlineScript(initialError ?? "");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>IDEFy ASCII Viewer</title>
<style>
    html, body {
        margin: 0;
        padding: 0;
        height: 100%;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size);
    }
    body { display: flex; flex-direction: column; }
    .toolbar {
        position: sticky; top: 0; z-index: 1;
        display: flex; gap: 4px; padding: 4px 8px; height: 28px;
        align-items: center;
        background: var(--vscode-editorWidget-background);
        border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
    }
    .toolbar button {
        background: var(--vscode-button-secondaryBackground, transparent);
        color: var(--vscode-button-secondaryForeground, inherit);
        border: 1px solid var(--vscode-button-border, transparent);
        padding: 2px 10px; font-size: var(--vscode-font-size);
        cursor: pointer; border-radius: 2px;
    }
    .toolbar button:hover {
        background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08)));
    }
    .viewer {
        flex: 1; padding: 12px; overflow: auto;
        white-space: pre; font-family: inherit; font-weight: bold;
    }
    .error {
        flex: 1; padding: 12px;
        color: var(--vscode-errorForeground, #f44747);
        font-family: var(--vscode-editor-font-family); white-space: pre-wrap;
    }
    .hidden { display: none; }

    /* Palette mirrors IdefyDecorator (packages/vscode/spec/UI.md §Цветовая палитра DSL). */
    body.vscode-dark  .role-I { color: #569CD6; }
    body.vscode-light .role-I { color: #0000FF; }
    body.vscode-dark  .role-O { color: #4EC9B0; }
    body.vscode-light .role-O { color: #267F99; }
    body.vscode-dark  .role-C { color: #DCDCAA; }
    body.vscode-light .role-C { color: #795E26; }
    body.vscode-dark  .role-M { color: #C586C0; }
    body.vscode-light .role-M { color: #AF00DB; }
    body.vscode-dark  .role-X { color: #9D9D9D; }
    body.vscode-light .role-X { color: #808080; }
    body.vscode-dark  .role-T { color: #CE9178; }
    body.vscode-light .role-T { color: #A0522D; }
    body.vscode-dark  .role-A { color: #F44747; }
    body.vscode-light .role-A { color: #A31515; }
</style>
</head>
<body>
<div class="toolbar">
    <button id="btn-copy-text" title="Copy ASCII as Text">Copy as Text</button>
    <button id="btn-copy-png" title="Copy ASCII as PNG (with role colors)">Copy as PNG</button>
</div>
<div id="viewer" class="viewer"></div>
<div id="error" class="error hidden"></div>
<script nonce="${nonce}">
(function () {
    const vscode = acquireVsCodeApi();
    const viewer = document.getElementById('viewer');
    const errorBox = document.getElementById('error');

    function clearChildren(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }
    function setContent(text, tokens) {
        errorBox.classList.add('hidden');
        viewer.classList.remove('hidden');
        clearChildren(viewer);
        renderTokensInto(viewer, text, tokens);
    }
    function setError(text) {
        viewer.classList.add('hidden');
        errorBox.classList.remove('hidden');
        errorBox.textContent = text;
    }
    function renderTokensInto(target, text, tokens) {
        let pos = 0;
        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];
            if (typeof tok.offset !== 'number' ||
                typeof tok.length !== 'number' ||
                typeof tok.role !== 'string') continue;
            if (tok.offset < pos) continue;
            if (tok.offset > pos) {
                target.appendChild(document.createTextNode(text.slice(pos, tok.offset)));
            }
            const span = document.createElement('span');
            span.className = 'role-' + tok.role;
            span.textContent = text.slice(tok.offset, tok.offset + tok.length);
            target.appendChild(span);
            pos = tok.offset + tok.length;
        }
        if (pos < text.length) {
            target.appendChild(document.createTextNode(text.slice(pos)));
        }
    }

    const __initialError = ${initialErrorJson};
    const __initialTokens = JSON.parse(${initialTokensJson});
    if (__initialError.length > 0) {
        setError(__initialError);
    } else {
        setContent(${initialContentJson}, __initialTokens);
    }

    window.addEventListener('message', function (ev) {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.kind === 'refresh' &&
            msg.payload &&
            typeof msg.payload.content === 'string' &&
            Array.isArray(msg.payload.tokens)) {
            setContent(msg.payload.content, msg.payload.tokens);
        } else if (msg.kind === 'error' && msg.payload && typeof msg.payload.message === 'string') {
            setError(msg.payload.message);
        }
    });

    document.getElementById('btn-copy-text').addEventListener('click', function () {
        vscode.postMessage({ kind: 'copy-text' });
    });

    document.getElementById('btn-copy-png').addEventListener('click', async function () {
        try {
            const blob = await renderViewerToPng();
            if (blob === null) {
                vscode.postMessage({ kind: 'copy-png-failed', payload: { reason: 'render-empty' } });
                return;
            }
            const written = await tryClipboardImage(blob);
            if (written) {
                vscode.postMessage({ kind: 'copy-png-ok' });
            } else {
                const base64 = await blobToBase64(blob);
                vscode.postMessage({ kind: 'copy-png-fallback', payload: { base64: base64 } });
            }
        } catch (err) {
            vscode.postMessage({
                kind: 'copy-png-failed',
                payload: { reason: String(err && err.message ? err.message : err) },
            });
        }
    });

    async function renderViewerToPng() {
        if (viewer.classList.contains('hidden')) return null;

        // Flatten viewer DOM into a sequence of (text, color) chunks. Spans
        // get their computed colour from the matching .role-X CSS rule; text
        // nodes inherit the viewer foreground. Newlines inside any chunk
        // split it onto subsequent lines so the canvas mirrors the screen.
        const baseColor = getComputedStyle(viewer).color;
        const chunks = [];
        const children = Array.from(viewer.childNodes);
        for (const node of children) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                chunks.push({
                    text: node.textContent || '',
                    color: getComputedStyle(node).color,
                });
            } else if (node.nodeType === Node.TEXT_NODE) {
                chunks.push({ text: node.textContent || '', color: baseColor });
            }
        }
        if (chunks.length === 0) return null;

        const lines = [[]];
        for (const chunk of chunks) {
            const parts = chunk.text.split('\\n');
            for (let i = 0; i < parts.length; i++) {
                if (i > 0) lines.push([]);
                if (parts[i].length > 0) {
                    lines[lines.length - 1].push({ text: parts[i], color: chunk.color });
                }
            }
        }
        while (lines.length > 1 && lines[lines.length - 1].length === 0) {
            lines.pop();
        }

        const computed = getComputedStyle(viewer);
        const fontFamily = computed.fontFamily || 'monospace';
        const fontSize = parseFloat(computed.fontSize) || 14;
        const fontWeight = computed.fontWeight || 'bold';
        const fontSpec = fontWeight + ' ' + fontSize + 'px ' + fontFamily;
        const bgColor = getComputedStyle(document.body).backgroundColor || '#fff';

        const measure = document.createElement('canvas').getContext('2d');
        measure.font = fontSpec;
        let maxWidth = 1;
        for (let li = 0; li < lines.length; li++) {
            let w = 0;
            for (const seg of lines[li]) {
                w += measure.measureText(seg.text).width;
            }
            if (w > maxWidth) maxWidth = w;
        }

        const lineHeight = Math.ceil(fontSize * 1.4);
        const padding = 12;
        const ratio = window.devicePixelRatio || 1;
        const width = Math.ceil(maxWidth) + padding * 2;
        const height = lineHeight * lines.length + padding * 2;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);
        ctx.font = fontSpec;
        ctx.textBaseline = 'top';
        for (let li = 0; li < lines.length; li++) {
            let x = padding;
            const y = padding + li * lineHeight;
            for (const seg of lines[li]) {
                ctx.fillStyle = seg.color;
                ctx.fillText(seg.text, x, y);
                x += ctx.measureText(seg.text).width;
            }
        }
        return await new Promise(function (resolve) {
            canvas.toBlob(function (b) { resolve(b); }, 'image/png');
        });
    }

    async function tryClipboardImage(blob) {
        try {
            if (typeof ClipboardItem !== 'function') return false;
            if (!navigator.clipboard || !navigator.clipboard.write) return false;
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            return true;
        } catch (e) {
            return false;
        }
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
                const result = reader.result;
                if (typeof result !== 'string') {
                    reject(new Error('reader.result is not a string'));
                    return;
                }
                const comma = result.indexOf(',');
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            reader.onerror = function () { reject(reader.error); };
            reader.readAsDataURL(blob);
        });
    }
})();
</script>
</body>
</html>`;
}

// JSON.stringify alone is not safe for embedding into inline <script> blocks:
// HTML tokenisation terminates the script element on the first `</script>` —
// even if it sits inside a JS string literal. Escape the slash to keep the
// payload opaque to the HTML parser.
function jsonForInlineScript(value: string): string {
    return JSON.stringify(value).replace(/<\//g, "<\\/");
}

export function generateNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < 32; i++) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
}
