import type { ICodeCellModel } from '@jupyterlab/cells';
import type { JupyterFrontEnd } from '@jupyterlab/application';
import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { Notebook, NotebookModel, StaticNotebook } from '@jupyterlab/notebook';
import {
  DEFAULT_CONTENT,
  NBTestUtils
} from '@jupyterlab/notebook/lib/testutils';
import { CommandRegistry } from '@lumino/commands';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';
import plugin, { NotebookNavigationRail } from '../index';

const notebookConfig: StaticNotebook.INotebookConfig = {
  ...StaticNotebook.defaultNotebookConfig,
  windowingMode: 'none'
};

function createNotebook(): Notebook {
  const widget = new Notebook({
    rendermime: NBTestUtils.defaultRenderMime(),
    contentFactory: NBTestUtils.createNotebookFactory(),
    mimeTypeService: NBTestUtils.mimeTypeService,
    notebookConfig
  });
  const model = new NotebookModel();
  model.fromJSON({
    ...DEFAULT_CONTENT,
    cells: [
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        outputs: [],
        source: ['a = 1']
      },
      {
        cell_type: 'markdown',
        metadata: {},
        source: ['# Heading\nBody text']
      },
      {
        cell_type: 'code',
        execution_count: 2,
        metadata: {},
        outputs: [],
        source: ['b = 2']
      }
    ]
  });
  widget.model = model;
  return widget;
}

describe('NotebookNavigationRail', () => {
  let notebook: Notebook;
  let rail: NotebookNavigationRail;

  beforeEach(() => {
    notebook = createNotebook();
    Widget.attach(notebook, document.body);
    rail = new NotebookNavigationRail(notebook);
    Widget.attach(rail, notebook.node);
  });

  afterEach(() => {
    Widget.detach(rail);
    rail.dispose();
    Widget.detach(notebook);
    notebook.dispose();
  });

  it('should render one horizontal line marker per cell', () => {
    const lines = rail.node.querySelectorAll(
      '.jp-Notebook-navigationRail-line'
    );
    expect(lines).toHaveLength(3);
  });

  it('should update aria-current and active class when active cell changes', () => {
    notebook.activeCellIndex = 1;
    const lines = rail.node.querySelectorAll(
      '.jp-Notebook-navigationRail-line'
    );
    expect(lines[1].classList.contains('jp-mod-active')).toBe(true);
    expect(lines[1].getAttribute('aria-current')).toBe('true');
    expect(lines[0].getAttribute('aria-current')).toBeNull();
  });

  it('should highlight error outputs and show them in hover preview', () => {
    const codeModel = notebook.model!.cells.get(0) as ICodeCellModel;
    codeModel.outputs.fromJSON([
      {
        output_type: 'error',
        ename: 'ZeroDivisionError',
        evalue: 'division by zero',
        traceback: ['ZeroDivisionError: division by zero']
      }
    ]);

    const lines = rail.node.querySelectorAll(
      '.jp-Notebook-navigationRail-line'
    ) as NodeListOf<HTMLElement>;
    expect(lines[0].classList.contains('jp-mod-error')).toBe(true);

    lines[0].dispatchEvent(new MouseEvent('mouseenter'));
    const tooltip = document.body.querySelector(
      '.jp-Notebook-navigationRail-tooltip'
    ) as HTMLElement;
    expect(tooltip.style.display).toBe('block');
    expect(tooltip.textContent).toContain(
      'ZeroDivisionError: division by zero'
    );

    rail.setHidden(true);
    expect(tooltip.style.display).toBe('none');
  });

  it('should jump to the clicked cell', () => {
    const lines = rail.node.querySelectorAll(
      '.jp-Notebook-navigationRail-line'
    ) as NodeListOf<HTMLElement>;
    lines[2].click();
    expect(notebook.activeCellIndex).toBe(2);
  });
});

describe('cell-navigation-rail plugin', () => {
  it('should register the toggle command disabled by default and toggle the rail', async () => {
    const notebook = createNotebook();
    Widget.attach(notebook, document.body);

    const disposed = new Signal<Record<string, unknown>, void>({});
    const panel = {
      content: notebook,
      context: { ready: Promise.resolve() },
      isDisposed: false,
      disposed
    } as unknown as NotebookPanel;

    const widgetAdded = new Signal<INotebookTracker, NotebookPanel>(
      {} as INotebookTracker
    );
    const tracker = {
      currentWidget: panel,
      forEach: (cb: (widget: NotebookPanel) => void) => cb(panel),
      widgetAdded
    } as unknown as INotebookTracker;

    const commands = new CommandRegistry();
    const app = {
      name: 'JupyterLab',
      commands,
      shell: { currentWidget: panel }
    } as unknown as JupyterFrontEnd;

    plugin.activate(app, tracker, null, null, null);

    expect(commands.hasCommand('cell-navigation-rail:toggle')).toBe(true);
    expect(commands.isToggled('cell-navigation-rail:toggle')).toBe(false);
    expect(notebook.hasClass('jp-mod-navigationRail')).toBe(false);

    await commands.execute('cell-navigation-rail:toggle');
    expect(commands.isToggled('cell-navigation-rail:toggle')).toBe(true);
    expect(notebook.hasClass('jp-mod-navigationRail')).toBe(true);

    await commands.execute('cell-navigation-rail:toggle');
    expect(commands.isToggled('cell-navigation-rail:toggle')).toBe(false);
    expect(notebook.hasClass('jp-mod-navigationRail')).toBe(false);

    disposed.emit();
    Widget.detach(notebook);
    notebook.dispose();
  });
});
