try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip.
    import warnings

    warnings.warn(
        "Importing 'jupyterlab_cell_navigation_rail' outside a proper installation."
    )
    __version__ = "dev"


def _jupyter_labextension_paths():
    return [
        {
            "src": "labextension",
            "dest": "jupyterlab-cell-navigation-rail",
        }
    ]
