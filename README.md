# jupyterlab-cell-navigation-rail

[![PyPI](https://img.shields.io/pypi/v/jupyterlab-cell-navigation-rail.svg)](https://pypi.org/project/jupyterlab-cell-navigation-rail/)
[![Build](https://github.com/saitejagirada/jupyterlab-cell-navigation-rail/actions/workflows/build.yml/badge.svg)](https://github.com/saitejagirada/jupyterlab-cell-navigation-rail/actions/workflows/build.yml)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/saitejagirada/jupyterlab-cell-navigation-rail/HEAD?urlpath=lab/tree/binder/demo.ipynb)

An opt-in, compact left-margin **Cell Navigation Rail** for **JupyterLab 4** and **Jupyter Notebook 7**.

Try it online with Binder in [JupyterLab](https://mybinder.org/v2/gh/saitejagirada/jupyterlab-cell-navigation-rail/HEAD?urlpath=lab/tree/binder/demo.ipynb) or [Jupyter Notebook 7](https://mybinder.org/v2/gh/saitejagirada/jupyterlab-cell-navigation-rail/HEAD?urlpath=notebooks/binder/demo.ipynb).

Each cell in the notebook is represented by a uniform horizontal bar in a fixed-height rail on the left edge, inspired by margin bookmark indicators in ePub readers and compact overview rails. Hovering a bar previews the cell (code, Markdown, or error traceback) with native Jupyter typography, and clicking jumps straight to that cell.

## Motivation

Navigating long notebooks to revisit a cell or spot failed runs usually means scrolling through the document or opening a side panel. Existing tools solve adjacent problems:

- **Table of Contents** requires Markdown headings and opens a sidebar.
- **Show Minimap** (`View -> Appearance -> Show Minimap`) shows a scrollable strip of scaled cell source previews along the right scrollbar.

**Cell Navigation Rail** focuses on a minimal, fixed-height glanceable margin rail:

- **Opt-in by default (`default: false`):** Disabled until enabled in the **View** menu or Settings.
- **Uniform horizontal bars (`12px x 2px`, expanding subtly on hover):** Neutral for idle cells, brand blue for the active cell, pulsing warning accent while running, and red when a cell output contains an error.
- **Hover preview cards:** Shows cell prompt, type, position (`2 / 5`), truncated code/Markdown lines, remaining line count, and error tracebacks with a status-colored accent border using native `--jp-*` tokens.
- **One-click jump:** Selecting any bar scrolls to and focuses that cell.
- **Works in JupyterLab 4 and Jupyter Notebook 7.**

## Screenshots

### Light Theme — View Menu & Error Preview

![View menu toggle](https://raw.githubusercontent.com/saitejagirada/jupyterlab-cell-navigation-rail/main/docs/screenshots/view-menu-toggle.png)

![Light theme rail and error preview](https://raw.githubusercontent.com/saitejagirada/jupyterlab-cell-navigation-rail/main/docs/screenshots/light-error-preview.png)

### Dark Theme & Native Token Adaptation

![Dark theme rail and error preview](https://raw.githubusercontent.com/saitejagirada/jupyterlab-cell-navigation-rail/main/docs/screenshots/dark-error-preview.png)

### Comparison with Built-in Minimap

Cell Navigation Rail (compact fixed-height bars + hover preview on the left) alongside JupyterLab's scrollable code Minimap (on the right):

![Navigation rail vs built-in minimap](https://raw.githubusercontent.com/saitejagirada/jupyterlab-cell-navigation-rail/main/docs/screenshots/minimap-comparison.png)

### Jupyter Notebook 7

![Jupyter Notebook 7 navigation rail](https://raw.githubusercontent.com/saitejagirada/jupyterlab-cell-navigation-rail/main/docs/screenshots/notebook7-rail.png)

## Requirements

- Python >= 3.10
- JupyterLab >= 4.0.0 (or Jupyter Notebook >= 7.0.0)

## Install

Install from PyPI:

```bash
pip install jupyterlab-cell-navigation-rail
```

You can also search for `jupyterlab-cell-navigation-rail` in JupyterLab’s built-in **Extension Manager**.

## Usage

Toggle the rail from:

- **View -> Show Cell Navigation Rail**
- Command Palette: **Show Cell Navigation Rail**
- Settings Editor: **Cell Navigation Rail -> Show cell navigation rail**

## Development install

```bash
git clone https://github.com/saitejagirada/jupyterlab-cell-navigation-rail.git
cd jupyterlab-cell-navigation-rail

pip install -e .
jupyter labextension develop . --overwrite
```

Rebuild TypeScript and run checks:

```bash
jlpm
jlpm run lint:check
jlpm run test
jlpm build
```

## Uninstall

```bash
pip uninstall jupyterlab-cell-navigation-rail
```
