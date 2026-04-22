"""Minimal setup.py used by the release automation workflows.

The project itself is deployed as container images rather than a PyPI
package, but the shared NeonGeckoCom release workflows expect to be able
to read the current version via ``python setup.py --version``.  This file
exists solely to satisfy that contract by surfacing the ``__version__``
defined in ``multi_llm_chatbot_backend/app/version.py``.
"""
from os import path

from setuptools import find_packages, setup

BASE_PATH = path.abspath(path.dirname(__file__))
VERSION_FILE = path.join(
    BASE_PATH, "multi_llm_chatbot_backend", "app", "version.py"
)

version = "0.0.0"
with open(VERSION_FILE, "r", encoding="utf-8") as v:
    for line in v.readlines():
        if line.startswith("__version__"):
            if '"' in line:
                version = line.split('"')[1]
            else:
                version = line.split("'")[1]
            break


setup(
    name="ccai-demo",
    version=version,
    description="CCAI PhD Advisor Demo (backend + frontend)",
    url="https://github.com/NeonGeckoCom/CCAI-Demo",
    author="NeonGecko",
    author_email="developers@neon.ai",
    license="BSD-3-Clause",
    packages=find_packages(where="multi_llm_chatbot_backend"),
    package_dir={"": "multi_llm_chatbot_backend"},
    classifiers=[
        "Intended Audience :: Developers",
        "Programming Language :: Python :: 3",
    ],
)
