import type {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import type { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import type { IChangedArgs } from '@jupyterlab/coreutils';
import type * as nbformat from '@jupyterlab/nbformat';
import {
  INotebookTracker,
  NotebookActions,
  type Notebook,
  type NotebookPanel
} from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import type { TranslationBundle } from '@jupyterlab/translation';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { type Message, MessageLoop } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';

const PLUGIN_ID = 'jupyterlab-cell-navigation-rail:plugin';
const COMMAND_ID = 'cell-navigation-rail:toggle';
const RAIL_CLASS = 'jp-Notebook-navigationRail';
const TRACK_CLASS = `${RAIL_CLASS}-track`;
const LINE_CLASS = `${RAIL_CLASS}-line`;
const TIP_CLASS = `${RAIL_CLASS}-tooltip`;
const ACTIVE_CLASS = 'jp-mod-active';
const ERROR_CLASS = 'jp-mod-error';
const RUNNING_CLASS = 'jp-mod-running';

const LINE_SPACING = 16;
const MAX_TRACK_HEIGHT = 360;
const MIN_HIT_HEIGHT = 4;
const MAX_HIT_HEIGHT = 10;
const PREVIEW_LINES = 4;
const MAX_PREVIEW_SCAN_CHARS = 4000;
const MAX_LINE_CHARS = 120;
const MAX_ERROR_NAME_CHARS = 80;
const MAX_ERROR_VALUE_CHARS = 240;

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const OSC_REGEX = new RegExp(
  `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  'g'
);
const CSI_REGEX = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const ESC_SEQ_REGEX = new RegExp(`${ESC}[@-Z\\\\-_]`, 'g');
const CONTROL_CHAR_REGEX = new RegExp(
  `[${String.fromCharCode(0x00)}-${String.fromCharCode(0x08)}${String.fromCharCode(0x0b)}${String.fromCharCode(0x0c)}${String.fromCharCode(0x0e)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}]`,
  'g'
);

interface ICellErrorInfo {
  hasError: boolean;
  ename?: string;
  evalue?: string;
}

interface ISourcePreview {
  lines: string[];
  extraLines: number;
  capped: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function sanitizeText(str: string, maxLength: number): string {
  const cleaned = str
    .replace(OSC_REGEX, '')
    .replace(CSI_REGEX, '')
    .replace(ESC_SEQ_REGEX, '')
    .replace(CONTROL_CHAR_REGEX, '')
    .trim();
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}…`
    : cleaned;
}

function extractPreview(raw: string): ISourcePreview {
  const capped = raw.length > MAX_PREVIEW_SCAN_CHARS;
  const slice = (capped ? raw.slice(0, MAX_PREVIEW_SCAN_CHARS) : raw).replace(
    /^(?:[ \t]*\r?\n)+|\s+$/g,
    ''
  );
  if (!slice) {
    return { lines: [], extraLines: 0, capped: false };
  }

  const lines: string[] = [];
  let extraLines = 0;
  let start = 0;

  while (start <= slice.length) {
    const nl = slice.indexOf('\n', start);
    const end = nl === -1 ? slice.length : nl;
    if (lines.length < PREVIEW_LINES) {
      let line = slice.slice(start, end).replace(/\r$/, '');
      if (line.length > MAX_LINE_CHARS) {
        line = `${line.slice(0, MAX_LINE_CHARS)}…`;
      }
      lines.push(line);
    } else {
      extraLines += 1;
    }
    if (nl === -1) {
      break;
    }
    start = nl + 1;
  }

  return { lines, extraLines, capped };
}

/**
 * A vertical cell navigation rail with active, running, and error indicators.
 */
export class NotebookNavigationRail extends Widget {
  readonly notebook: Notebook;
  private _trans: TranslationBundle;
  private _track: HTMLElement;
  private _tooltip: HTMLElement | null = null;
  private _cellListeners: Map<string, () => void> = new Map();
  private _hoveredCellId: string | null = null;
  private _connectedModel: Notebook['model'] = null;
  private _onDismissTooltip = () => this._hideTooltip();

  constructor(notebook: Notebook, translator?: ITranslator) {
    super();
    this.addClass(RAIL_CLASS);
    this.notebook = notebook;
    this._trans = (translator ?? nullTranslator).load('jupyterlab');
    this.node.setAttribute('role', 'navigation');
    this.node.setAttribute(
      'aria-label',
      this._trans.__('Cell navigation rail')
    );

    this._track = el('div', TRACK_CLASS);
    this.node.appendChild(this._track);

    this.notebook.activeCellChanged.connect(this._onActiveCellChanged, this);
    this.notebook.modelChanged.connect(this._onModelChanged, this);
    window.addEventListener('blur', this._onDismissTooltip);
    this.notebook.outerNode?.addEventListener(
      'scroll',
      this._onDismissTooltip,
      { passive: true }
    );
    this._connectModelCells();
    this._updateLines();
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._clearCellListeners();
    window.removeEventListener('blur', this._onDismissTooltip);
    this.notebook.outerNode?.removeEventListener(
      'scroll',
      this._onDismissTooltip
    );
    this.notebook.activeCellChanged.disconnect(this._onActiveCellChanged, this);
    this.notebook.modelChanged.disconnect(this._onModelChanged, this);
    this._connectedModel?.cells.changed.disconnect(this._updateLines, this);
    this._connectedModel = null;
    this._tooltip?.remove();
    this._tooltip = null;
    super.dispose();
  }

  setHidden(hidden: boolean): void {
    if (hidden) {
      this._hideTooltip();
    }
    super.setHidden(hidden);
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this._updateLines();
  }

  protected onBeforeHide(msg: Message): void {
    this._hideTooltip();
    super.onBeforeHide(msg);
  }

  protected onBeforeDetach(msg: Message): void {
    this._hideTooltip();
    super.onBeforeDetach(msg);
  }

  private _connectModelCells(): void {
    this._connectedModel = this.notebook.model;
    this._connectedModel?.cells.changed.connect(this._updateLines, this);
  }

  private _onModelChanged(): void {
    this._connectedModel?.cells.changed.disconnect(this._updateLines, this);
    this._connectedModel = null;
    this._clearCellListeners();
    this._connectModelCells();
    this._updateLines();
  }

  private _onActiveCellChanged(): void {
    const activeIndex = this.notebook.activeCellIndex;
    const children = this._track.children;
    for (let i = 0; i < children.length; i++) {
      const line = children[i];
      const isActive = i === activeIndex;
      line.classList.toggle(ACTIVE_CLASS, isActive);
      if (isActive) {
        line.setAttribute('aria-current', 'true');
      } else {
        line.removeAttribute('aria-current');
      }
    }
  }

  private _clearCellListeners(): void {
    this._cellListeners.forEach(disconnect => disconnect());
    this._cellListeners.clear();
  }

  private _updateLines(): void {
    this._clearCellListeners();

    const model = this.notebook.model;
    if (!model) {
      this._track.replaceChildren();
      this._track.style.height = '0';
      this._hideTooltip();
      return;
    }

    const cells = model.cells;
    const total = cells.length;
    const activeIndex = this.notebook.activeCellIndex;
    const trackHeight = Math.min(total * LINE_SPACING, MAX_TRACK_HEIGHT);
    this._track.style.height = `${trackHeight}px`;

    if (total > 0) {
      const hitHeight = Math.max(
        MIN_HIT_HEIGHT,
        Math.min(MAX_HIT_HEIGHT, Math.floor(trackHeight / total))
      );
      this._track.style.setProperty(
        '--jp-nav-rail-hit-height',
        `${hitHeight}px`
      );
    }

    let hoveredStillExists = false;
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < total; i++) {
      const cell = cells.get(i);
      if (this._hoveredCellId && cell.id === this._hoveredCellId) {
        hoveredStillExists = true;
      }
      const line = this._createLine(cell, i, total);
      line.style.top = `${((i + 0.5) / total) * 100}%`;
      if (i === activeIndex) {
        line.classList.add(ACTIVE_CLASS);
        line.setAttribute('aria-current', 'true');
      }
      fragment.appendChild(line);
      this._attachCellListeners(cell, line, i, total);
    }

    this._track.replaceChildren(fragment);
    if (this._hoveredCellId && !hoveredStillExists) {
      this._hideTooltip();
    }
  }

  private _formatAriaLabel(
    index: number,
    total: number,
    errorInfo: ICellErrorInfo
  ): string {
    return errorInfo.hasError
      ? this._trans.__(
          'Error in cell %1 of %2: %3',
          index + 1,
          total,
          errorInfo.ename || this._trans.__('Error')
        )
      : this._trans.__('Cell %1 of %2', index + 1, total);
  }

  private _createLine(
    cell: ICellModel,
    index: number,
    total: number
  ): HTMLElement {
    const line = el('button', LINE_CLASS);
    line.type = 'button';
    line.setAttribute('tabindex', '-1');
    line.dataset.cellId = cell.id;
    line.dataset.index = `${index}`;
    line.dataset.type = cell.type;

    const errorInfo = this._getCellError(cell);
    line.classList.toggle(ERROR_CLASS, errorInfo.hasError);
    line.setAttribute(
      'aria-label',
      this._formatAriaLabel(index, total, errorInfo)
    );

    if (
      cell.type === 'code' &&
      (cell as ICodeCellModel).executionState === 'running'
    ) {
      line.classList.add(RUNNING_CLASS);
    }

    line.addEventListener('click', event => {
      event.stopPropagation();
      this._onLineClick(index);
    });
    line.addEventListener('mouseenter', () => {
      this._showTooltip(cell, index, line);
    });
    line.addEventListener('mouseleave', this._onDismissTooltip);

    return line;
  }

  private _attachCellListeners(
    cell: ICellModel,
    line: HTMLElement,
    index: number,
    total: number
  ): void {
    const disconnects: Array<() => void> = [];
    const refreshHovered = () => {
      if (this._hoveredCellId === cell.id) {
        this._renderTooltipContent(cell, index);
      }
    };

    if (cell.type === 'code') {
      const codeModel = cell as ICodeCellModel;
      const onOutputsChanged = () => {
        const errorInfo = this._getCellError(codeModel);
        line.classList.toggle(ERROR_CLASS, errorInfo.hasError);
        line.setAttribute(
          'aria-label',
          this._formatAriaLabel(index, total, errorInfo)
        );
        refreshHovered();
      };
      const onStateChanged = (
        _: ICellModel,
        change: IChangedArgs<unknown, unknown>
      ) => {
        if (change.name === 'executionState') {
          line.classList.toggle(
            RUNNING_CLASS,
            codeModel.executionState === 'running'
          );
        }
        refreshHovered();
      };

      const outputs = codeModel.outputs;
      if (outputs) {
        outputs.changed.connect(onOutputsChanged);
        disconnects.push(() => outputs.changed.disconnect(onOutputsChanged));
      }
      codeModel.stateChanged.connect(onStateChanged);
      disconnects.push(() => codeModel.stateChanged.disconnect(onStateChanged));
    }

    const sharedModel = cell.sharedModel;
    sharedModel.changed.connect(refreshHovered);
    disconnects.push(() => sharedModel.changed.disconnect(refreshHovered));
    this._cellListeners.set(cell.id, () => disconnects.forEach(fn => fn()));
  }

  private _getCellError(cell: ICellModel): ICellErrorInfo {
    if (cell.type !== 'code') {
      return { hasError: false };
    }
    const outputs = (cell as ICodeCellModel).outputs;
    if (!outputs) {
      return { hasError: false };
    }
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs.get(i);
      if (output.type === 'error') {
        const errorJson = output.toJSON() as nbformat.IError;
        return {
          hasError: true,
          ename: sanitizeText(errorJson.ename || 'Error', MAX_ERROR_NAME_CHARS),
          evalue: sanitizeText(errorJson.evalue || '', MAX_ERROR_VALUE_CHARS)
        };
      }
    }
    return { hasError: false };
  }

  private _onLineClick(index: number): void {
    if (index < 0 || index >= this._track.children.length) {
      return;
    }
    this.notebook.activeCellIndex = index;
    const cellWidget = this.notebook.widgets[index];
    if (cellWidget) {
      void this.notebook.scrollToCell(cellWidget, 'center');
    } else {
      void this.notebook.scrollToItem(index, 'center');
    }
    void NotebookActions.focusActiveCell(this.notebook);
  }

  private _ensureTooltip(): HTMLElement {
    if (!this._tooltip) {
      const tip = el('div', TIP_CLASS);
      tip.setAttribute('role', 'tooltip');
      tip.style.display = 'none';
      document.body.appendChild(tip);
      this._tooltip = tip;
    }
    return this._tooltip;
  }

  private _showTooltip(
    cell: ICellModel,
    index: number,
    lineElement: HTMLElement
  ): void {
    this._hoveredCellId = cell.id;
    const tooltip = this._ensureTooltip();
    this._renderTooltipContent(cell, index);

    const rect = lineElement.getBoundingClientRect();
    let x = rect.right + 10;
    let y = Math.max(8, rect.top - 14);
    tooltip.style.display = 'block';
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;

    const box = tooltip.getBoundingClientRect();
    if (x + box.width > window.innerWidth - 12) {
      x = Math.max(12, window.innerWidth - box.width - 12);
      tooltip.style.left = `${x}px`;
    }
    if (y + box.height > window.innerHeight - 12) {
      y = Math.max(8, window.innerHeight - box.height - 12);
      tooltip.style.top = `${y}px`;
    }
  }

  private _renderTooltipContent(cell: ICellModel, index: number): void {
    const tooltip = this._ensureTooltip();
    const errorInfo = this._getCellError(cell);
    const codeModel = cell.type === 'code' ? (cell as ICodeCellModel) : null;
    const isRunning = codeModel?.executionState === 'running';
    const preview = extractPreview(cell.sharedModel.getSource() || '');
    const total = Math.max(
      this.notebook.model?.cells.length ?? 0,
      this._track.children.length
    );

    tooltip.classList.toggle(
      ACTIVE_CLASS,
      index === this.notebook.activeCellIndex
    );
    tooltip.classList.toggle(RUNNING_CLASS, Boolean(isRunning));
    tooltip.classList.toggle(ERROR_CLASS, errorInfo.hasError);
    tooltip.replaceChildren();

    const meta = el('div', `${TIP_CLASS}-meta`);
    if (codeModel) {
      const promptText = errorInfo.hasError
        ? '[!]'
        : isRunning
          ? '[*]'
          : codeModel.executionCount !== null
            ? `[${codeModel.executionCount}]`
            : '[ ]';
      const kindText = errorInfo.hasError
        ? this._trans.__('Error')
        : isRunning
          ? this._trans.__('Running')
          : this._trans.__('Code');
      meta.append(
        el('span', `${TIP_CLASS}-prompt`, promptText),
        el('span', `${TIP_CLASS}-kind`, kindText)
      );
    } else {
      meta.append(
        el(
          'span',
          `${TIP_CLASS}-kind`,
          cell.type === 'markdown'
            ? this._trans.__('Markdown')
            : this._trans.__('Raw')
        )
      );
    }

    const header = el('div', `${TIP_CLASS}-header`);
    header.append(
      meta,
      el('span', `${TIP_CLASS}-index`, `${index + 1} / ${total}`)
    );
    tooltip.appendChild(header);

    const body = el('div', `${TIP_CLASS}-body`);
    if (cell.type === 'markdown') {
      if (preview.lines.length > 0) {
        const md = el('div', `${TIP_CLASS}-markdown`);
        const headingMatch = /^#{1,6}[ \t]+(\S.*)$/.exec(preview.lines[0]);
        if (headingMatch) {
          md.appendChild(
            el('div', `${TIP_CLASS}-markdown-heading`, headingMatch[1])
          );
        }
        const prose = (headingMatch ? preview.lines.slice(1) : preview.lines)
          .map(line => line.trim())
          .filter(Boolean);
        if (prose.length > 0) {
          md.appendChild(
            el('div', `${TIP_CLASS}-markdown-body`, prose.join('\n'))
          );
        }
        body.appendChild(md);
      } else {
        body.appendChild(
          el('div', `${TIP_CLASS}-empty`, this._trans.__('Empty markdown cell'))
        );
      }
    } else if (preview.lines.length > 0) {
      const code = el('div', `${TIP_CLASS}-code`);
      for (const lineText of preview.lines) {
        code.appendChild(el('div', `${TIP_CLASS}-line`, lineText || ' '));
      }
      body.appendChild(code);
    } else {
      body.appendChild(
        el(
          'div',
          `${TIP_CLASS}-empty`,
          cell.type === 'raw'
            ? this._trans.__('Empty raw cell')
            : this._trans.__('Empty cell')
        )
      );
    }

    if (preview.extraLines > 0 || preview.capped) {
      const moreText =
        preview.extraLines > 0
          ? preview.capped
            ? this._trans.__('+%1+ more lines', preview.extraLines)
            : preview.extraLines === 1
              ? this._trans.__('+1 more line')
              : this._trans.__('+%1 more lines', preview.extraLines)
          : this._trans.__('Truncated preview');
      body.appendChild(el('div', `${TIP_CLASS}-more`, moreText));
    }
    tooltip.appendChild(body);

    if (errorInfo.hasError) {
      const errorEl = el('div', `${TIP_CLASS}-error`);
      errorEl.append(
        el(
          'span',
          `${TIP_CLASS}-error-name`,
          errorInfo.ename || this._trans.__('Error')
        ),
        document.createTextNode(
          `: ${errorInfo.evalue || this._trans.__('Execution failed')}`
        )
      );
      tooltip.appendChild(errorEl);
    }
  }

  private _hideTooltip(): void {
    this._hoveredCellId = null;
    if (this._tooltip) {
      this._tooltip.style.display = 'none';
    }
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description: 'Adds a cell navigation rail with a View menu toggle.',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ICommandPalette, ISettingRegistry, ITranslator],
  activate: (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    palette: ICommandPalette | null,
    settingRegistry: ISettingRegistry | null,
    translator: ITranslator | null
  ) => {
    const trans = (translator ?? nullTranslator).load('jupyterlab');
    let enabled = false;
    let settings: ISettingRegistry.ISettings | null = null;
    const rails = new Map<NotebookPanel, NotebookNavigationRail>();

    const syncVisibility = (show: boolean) => {
      enabled = show;
      rails.forEach((rail, panel) => {
        if (!panel.isDisposed && !rail.isDisposed) {
          rail.setHidden(!show);
          panel.content.toggleClass('jp-mod-navigationRail', show);
        }
      });
      app.commands.notifyCommandChanged(COMMAND_ID);
    };

    const attachRail = (panel: NotebookPanel) => {
      if (rails.has(panel) || panel.isDisposed) {
        return;
      }
      const rail = new NotebookNavigationRail(
        panel.content,
        translator ?? undefined
      );
      rail.setHidden(!enabled);
      panel.content.toggleClass('jp-mod-navigationRail', enabled);
      rails.set(panel, rail);

      const mount = () => {
        if (
          !panel.isDisposed &&
          !rail.isDisposed &&
          !rail.isAttached &&
          panel.content.node.isConnected
        ) {
          Widget.attach(rail, panel.content.node);
        }
      };

      const hook = (_handler: unknown, msg: Message): boolean => {
        if (msg.type === 'after-attach') {
          mount();
        } else if (msg.type === 'before-detach' && rail.isAttached) {
          Widget.detach(rail);
        }
        return true;
      };

      MessageLoop.installMessageHook(panel.content, hook);
      if (panel.content.isAttached) {
        mount();
      }

      panel.disposed.connect(() => {
        MessageLoop.removeMessageHook(panel.content, hook);
        if (rail.isAttached) {
          Widget.detach(rail);
        }
        rail.dispose();
        rails.delete(panel);
      });
    };

    tracker.forEach(attachRail);
    tracker.widgetAdded.connect((_, panel) => attachRail(panel));

    const isNotebookActive = () =>
      tracker.currentWidget !== null &&
      (app.name === 'Jupyter Notebook' ||
        tracker.currentWidget === app.shell.currentWidget);

    app.commands.addCommand(COMMAND_ID, {
      label: trans.__('Show Cell Navigation Rail'),
      caption: trans.__('Show or hide the cell navigation rail'),
      isEnabled: isNotebookActive,
      isToggled: () => enabled,
      describedBy: { args: { type: 'object', properties: {} } },
      execute: async () => {
        if (!isNotebookActive()) {
          return;
        }
        const nextValue = !enabled;
        if (settings) {
          await settings.set('showCellNavigationRail', nextValue);
        } else {
          syncVisibility(nextValue);
        }
      }
    });

    if (palette) {
      palette.addItem({
        command: COMMAND_ID,
        category: trans.__('Notebook Operations')
      });
    }

    if (settingRegistry) {
      void settingRegistry
        .load(PLUGIN_ID)
        .then(loaded => {
          settings = loaded;
          const applySetting = () =>
            syncVisibility(
              Boolean(loaded.get('showCellNavigationRail').composite)
            );
          applySetting();
          loaded.changed.connect(applySetting);
        })
        .catch(reason => {
          console.warn('Failed to load cell navigation rail settings:', reason);
        });
    }
  }
};

export default plugin;
