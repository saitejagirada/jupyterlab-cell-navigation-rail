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
import type { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';

const PLUGIN_ID = 'jupyterlab-cell-navigation-rail:plugin';
const COMMAND_ID = 'cell-navigation-rail:toggle';
const NAVIGATION_RAIL_CLASS = 'jp-Notebook-navigationRail';
const TRACK_CLASS = 'jp-Notebook-navigationRail-track';
const LINE_CLASS = 'jp-Notebook-navigationRail-line';
const TOOLTIP_CLASS = 'jp-Notebook-navigationRail-tooltip';
const ACTIVE_LINE_CLASS = 'jp-mod-active';
const ERROR_LINE_CLASS = 'jp-mod-error';
const RUNNING_LINE_CLASS = 'jp-mod-running';
const LINE_SPACING = 16;
const MAX_TRACK_HEIGHT = 360;
const MIN_HIT_HEIGHT = 4;
const MAX_HIT_HEIGHT = 10;
const ANSI_ESCAPE_REGEX = new RegExp(
  `${String.fromCharCode(0x1b)}\\[[0-9;]*m`,
  'g'
);

interface ICellErrorInfo {
  hasError: boolean;
  ename?: string;
  evalue?: string;
}

/**
 * A vertical cell navigation rail with active, running, and error indicators.
 */
export class NotebookNavigationRail extends Widget {
  readonly notebook: Notebook;
  private _trans: TranslationBundle;
  private _track: HTMLElement;
  private _tooltip: HTMLElement;
  private _cellListeners: Map<string, () => void> = new Map();
  private _hoveredCellId: string | null = null;
  private _connectedModel: Notebook['model'] = null;

  constructor(notebook: Notebook, translator?: ITranslator) {
    super();
    this.addClass(NAVIGATION_RAIL_CLASS);
    this.notebook = notebook;
    this._trans = (translator ?? nullTranslator).load('jupyterlab');
    this.node.setAttribute('role', 'navigation');
    this.node.setAttribute(
      'aria-label',
      this._trans.__('Cell navigation rail')
    );

    this._track = document.createElement('div');
    this._track.className = TRACK_CLASS;
    this.node.appendChild(this._track);

    this._tooltip = document.createElement('div');
    this._tooltip.className = TOOLTIP_CLASS;
    this._tooltip.setAttribute('role', 'tooltip');
    this._tooltip.style.display = 'none';
    document.body.appendChild(this._tooltip);

    this.notebook.activeCellChanged.connect(this._onActiveCellChanged, this);
    this.notebook.modelChanged.connect(this._onModelChanged, this);
    this._connectModelCells();
    this._updateLines();
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._clearCellListeners();
    this.notebook.activeCellChanged.disconnect(this._onActiveCellChanged, this);
    this.notebook.modelChanged.disconnect(this._onModelChanged, this);
    this._connectedModel?.cells.changed.disconnect(this._onCellsChanged, this);
    this._connectedModel = null;
    this._tooltip.remove();
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
    this._connectedModel?.cells.changed.connect(this._onCellsChanged, this);
  }

  private _onModelChanged(): void {
    this._connectedModel?.cells.changed.disconnect(this._onCellsChanged, this);
    this._connectedModel = null;
    this._clearCellListeners();
    this._connectModelCells();
    this._updateLines();
  }

  private _onCellsChanged(): void {
    this._updateLines();
  }

  private _onActiveCellChanged(): void {
    const activeIndex = this.notebook.activeCellIndex;
    Array.from(this._track.children).forEach((line, index) => {
      const isActive = index === activeIndex;
      line.classList.toggle(ACTIVE_LINE_CLASS, isActive);
      if (isActive) {
        line.setAttribute('aria-current', 'true');
      } else {
        line.removeAttribute('aria-current');
      }
    });
  }

  private _clearCellListeners(): void {
    this._cellListeners.forEach(disconnect => disconnect());
    this._cellListeners.clear();
  }

  private _updateLines(): void {
    this._clearCellListeners();
    this._track.replaceChildren();

    if (!this.notebook.model) {
      this._track.style.height = '0';
      this._hideTooltip();
      return;
    }

    const cells = Array.from(this.notebook.model.cells);
    const activeIndex = this.notebook.activeCellIndex;
    const total = cells.length;
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

    if (
      this._hoveredCellId &&
      !cells.some(cell => cell.id === this._hoveredCellId)
    ) {
      this._hideTooltip();
    }

    for (let i = 0; i < total; i++) {
      const cell = cells[i];
      const line = this._createLine(cell, i, total);
      if (i === activeIndex) {
        line.classList.add(ACTIVE_LINE_CLASS);
        line.setAttribute('aria-current', 'true');
      }
      this._track.appendChild(line);
      this._attachCellListeners(cell, line, i, total);
    }

    if (total > 0) {
      Array.from(this._track.children).forEach((child, index) => {
        (child as HTMLElement).style.top = `${((index + 0.5) / total) * 100}%`;
      });
    }
  }

  private _createLine(
    cell: ICellModel,
    index: number,
    total: number
  ): HTMLElement {
    const line = document.createElement('button');
    line.className = LINE_CLASS;
    line.type = 'button';
    line.setAttribute('tabindex', '-1');
    line.dataset.cellId = cell.id;
    line.dataset.index = `${index}`;
    line.dataset.type = cell.type;

    const errorInfo = this._getCellError(cell);
    if (errorInfo.hasError) {
      line.classList.add(ERROR_LINE_CLASS);
      line.setAttribute(
        'aria-label',
        this._trans.__(
          'Error in cell %1 of %2: %3',
          index + 1,
          total,
          errorInfo.ename ?? this._trans.__('Error')
        )
      );
    } else {
      line.setAttribute(
        'aria-label',
        this._trans.__('Cell %1 of %2', index + 1, total)
      );
    }

    if (cell.type === 'code') {
      const codeModel = cell as ICodeCellModel;
      if (codeModel.executionState === 'running') {
        line.classList.add(RUNNING_LINE_CLASS);
      }
    }

    line.addEventListener('click', event => {
      event.stopPropagation();
      this._onLineClick(index);
    });

    line.addEventListener('mouseenter', () => {
      this._showTooltip(cell, index, line);
    });

    line.addEventListener('mouseleave', () => {
      this._hideTooltip();
    });

    return line;
  }

  private _attachCellListeners(
    cell: ICellModel,
    line: HTMLElement,
    index: number,
    total: number
  ): void {
    const disconnects: Array<() => void> = [];

    if (cell.type === 'code') {
      const codeModel = cell as ICodeCellModel;
      const outputs = codeModel.outputs;

      const onOutputsChanged = () => {
        const errorInfo = this._getCellError(codeModel);
        line.classList.toggle(ERROR_LINE_CLASS, errorInfo.hasError);
        line.setAttribute(
          'aria-label',
          errorInfo.hasError
            ? this._trans.__(
                'Error in cell %1 of %2: %3',
                index + 1,
                total,
                errorInfo.ename ?? this._trans.__('Error')
              )
            : this._trans.__('Cell %1 of %2', index + 1, total)
        );
        if (this._hoveredCellId === cell.id) {
          this._renderTooltipContent(cell, index);
        }
      };

      const onStateChanged = (
        _: ICellModel,
        change: IChangedArgs<unknown, unknown>
      ) => {
        if (change.name === 'executionState') {
          line.classList.toggle(
            RUNNING_LINE_CLASS,
            codeModel.executionState === 'running'
          );
        }
        if (this._hoveredCellId === cell.id) {
          this._renderTooltipContent(cell, index);
        }
      };

      if (outputs) {
        outputs.changed.connect(onOutputsChanged);
        disconnects.push(() => outputs.changed.disconnect(onOutputsChanged));
      }

      codeModel.stateChanged.connect(onStateChanged);
      disconnects.push(() => codeModel.stateChanged.disconnect(onStateChanged));
    }

    const onSourceChanged = () => {
      if (this._hoveredCellId === cell.id) {
        this._renderTooltipContent(cell, index);
      }
    };
    cell.sharedModel.changed.connect(onSourceChanged);
    disconnects.push(() =>
      cell.sharedModel.changed.disconnect(onSourceChanged)
    );

    this._cellListeners.set(cell.id, () => {
      disconnects.forEach(fn => fn());
    });
  }

  private _getCellError(cell: ICellModel): ICellErrorInfo {
    if (cell.type !== 'code') {
      return { hasError: false };
    }
    const model = cell as ICodeCellModel;
    if (!model.outputs) {
      return { hasError: false };
    }
    for (let i = 0; i < model.outputs.length; i++) {
      const output = model.outputs.get(i);
      if (output.type === 'error') {
        const errorJson = output.toJSON() as nbformat.IError;
        return {
          hasError: true,
          ename: errorJson.ename || 'Error',
          evalue: errorJson.evalue || ''
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

  private _showTooltip(
    cell: ICellModel,
    index: number,
    lineElement: HTMLElement
  ): void {
    this._hoveredCellId = cell.id;
    this._renderTooltipContent(cell, index);

    const rect = lineElement.getBoundingClientRect();
    let tooltipX = rect.right + 10;
    let tooltipY = Math.max(8, rect.top - 10);

    this._tooltip.style.display = 'block';
    this._tooltip.style.left = `${tooltipX}px`;
    this._tooltip.style.top = `${tooltipY}px`;

    const tooltipRect = this._tooltip.getBoundingClientRect();
    if (tooltipX + tooltipRect.width > window.innerWidth - 12) {
      tooltipX = Math.max(12, window.innerWidth - tooltipRect.width - 12);
      this._tooltip.style.left = `${tooltipX}px`;
    }
    if (tooltipY + tooltipRect.height > window.innerHeight - 12) {
      tooltipY = Math.max(8, window.innerHeight - tooltipRect.height - 12);
      this._tooltip.style.top = `${tooltipY}px`;
    }
  }

  private _renderTooltipContent(cell: ICellModel, index: number): void {
    const errorInfo = this._getCellError(cell);
    const source = (cell.sharedModel.getSource() || '').trim();
    const lines = source ? source.split('\n') : [];
    const totalCells = Math.max(
      this.notebook.model?.cells.length ?? 0,
      this._track.children.length
    );

    this._tooltip.replaceChildren();

    const header = document.createElement('div');
    header.className = 'jp-Notebook-navigationRail-tooltip-header';
    header.textContent = this._trans.__('Cell %1 of %2', index + 1, totalCells);
    this._tooltip.appendChild(header);

    if (cell.type === 'markdown') {
      if (lines.length > 0) {
        const container = document.createElement('div');
        container.className = 'jp-Notebook-navigationRail-tooltip-markdown';

        const headingMatch = /^#{1,6}[ \t]+(\S.*)$/.exec(lines[0]);
        if (headingMatch) {
          const heading = document.createElement('div');
          heading.className =
            'jp-Notebook-navigationRail-tooltip-markdown-heading';
          heading.textContent = headingMatch[1];
          container.appendChild(heading);
        }

        const bodyLines = (headingMatch ? lines.slice(1, 4) : lines.slice(0, 4))
          .map(line => line.trim())
          .filter(Boolean);
        if (bodyLines.length > 0) {
          const body = document.createElement('div');
          body.className = 'jp-Notebook-navigationRail-tooltip-markdown-body';
          body.textContent =
            bodyLines.join('\n') + (lines.length > 4 ? '\n...' : '');
          container.appendChild(body);
        }
        this._tooltip.appendChild(container);
      } else {
        const empty = document.createElement('div');
        empty.className = 'jp-Notebook-navigationRail-tooltip-empty';
        empty.textContent = this._trans.__('Empty markdown cell');
        this._tooltip.appendChild(empty);
      }
    } else if (lines.length > 0) {
      const code = document.createElement('pre');
      code.className = 'jp-Notebook-navigationRail-tooltip-code';
      code.textContent =
        lines.slice(0, 4).join('\n') + (lines.length > 4 ? '\n...' : '');
      this._tooltip.appendChild(code);
    } else {
      const empty = document.createElement('div');
      empty.className = 'jp-Notebook-navigationRail-tooltip-empty';
      empty.textContent =
        cell.type === 'raw'
          ? this._trans.__('Empty raw cell')
          : this._trans.__('Empty cell');
      this._tooltip.appendChild(empty);
    }

    if (errorInfo.hasError) {
      const errorEl = document.createElement('div');
      errorEl.className = 'jp-Notebook-navigationRail-tooltip-error';

      const nameEl = document.createElement('span');
      nameEl.className = 'jp-Notebook-navigationRail-tooltip-error-name';
      nameEl.textContent = errorInfo.ename || this._trans.__('Error');
      errorEl.appendChild(nameEl);

      errorEl.appendChild(
        document.createTextNode(
          `: ${this._stripAnsi(errorInfo.evalue || this._trans.__('Execution failed'))}`
        )
      );
      this._tooltip.appendChild(errorEl);
    }
  }

  private _hideTooltip(): void {
    this._hoveredCellId = null;
    this._tooltip.style.display = 'none';
  }

  private _stripAnsi(str: string): string {
    return str.replace(ANSI_ESCAPE_REGEX, '');
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
        if (!panel.isDisposed && !rail.isDisposed && !rail.isAttached) {
          Widget.attach(rail, panel.content.node);
        }
      };

      if (panel.content.isAttached) {
        mount();
      } else {
        void panel.context.ready.then(mount);
        requestAnimationFrame(mount);
      }

      panel.disposed.connect(() => {
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
      describedBy: {
        args: {
          type: 'object',
          properties: {}
        }
      },
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
          const applySetting = () => {
            const value = Boolean(
              loaded.get('showCellNavigationRail').composite
            );
            syncVisibility(value);
          };
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
