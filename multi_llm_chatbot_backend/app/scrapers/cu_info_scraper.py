# NEON AI (TM) SOFTWARE, Software Development Kit & Application Framework
# All Rights Reserved 2008-2025
# Licensed under the BSD 3-Clause License
# https://opensource.org/licenses/BSD-3-Clause
#
# Copyright (c) 2008-2025, Neongecko.com Inc.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are met:
# 1. Redistributions of source code must retain the above copyright notice,
#    this list of conditions and the following disclaimer.
# 2. Redistributions in binary form must reproduce the above copyright notice,
#    this list of conditions and the following disclaimer in the documentation
#    and/or other materials provided with the distribution.
# 3. Neither the name of the copyright holder nor the names of its contributors
#    may be used to endorse or promote products derived from this software
#    without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
# LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
# CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
# POSSIBILITY OF SUCH DAMAGE.

"""
CU Boulder General Information Scraper — fetches key pages from
colorado.edu and saves them as plain-text files in the data/ directory
for ingestion into the Global RAG.
"""

import logging
import re
from pathlib import Path
from typing import Dict, List, Optional

import httpx

LOG = logging.getLogger(__name__)

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

PAGES: List[Dict[str, str]] = [
    {
        "url": "https://www.colorado.edu/about",
        "filename": "cu_boulder_about.txt",
        "title": "About CU Boulder",
    },
    {
        "url": "https://www.colorado.edu/academics",
        "filename": "cu_boulder_academics.txt",
        "title": "Academic Programs & Resources",
    },
    {
        "url": "https://www.colorado.edu/academics/colleges-schools",
        "filename": "cu_boulder_colleges_schools.txt",
        "title": "Colleges & Schools",
    },
    {
        "url": "https://www.colorado.edu/admissions",
        "filename": "cu_boulder_admissions.txt",
        "title": "Admissions",
    },
    {
        "url": "https://www.colorado.edu/admissions/cost",
        "filename": "cu_boulder_cost.txt",
        "title": "Cost of Attendance",
    },
    {
        "url": "https://www.colorado.edu/students",
        "filename": "cu_boulder_student_resources.txt",
        "title": "Student Support & Resources",
    },
    {
        "url": "https://www.colorado.edu/studentaffairs",
        "filename": "cu_boulder_student_life.txt",
        "title": "Division of Student Life",
    },
    {
        "url": "https://www.colorado.edu/housing",
        "filename": "cu_boulder_housing.txt",
        "title": "Housing",
    },
    {
        "url": "https://www.colorado.edu/registrar/students",
        "filename": "cu_boulder_registrar.txt",
        "title": "Registrar – Student Services",
    },
    {
        "url": "https://www.colorado.edu/financialaid",
        "filename": "cu_boulder_financial_aid.txt",
        "title": "Financial Aid",
    },
    {
        "url": "https://www.colorado.edu/career",
        "filename": "cu_boulder_career_services.txt",
        "title": "Career Services",
    },
    {
        "url": "https://www.colorado.edu/counseling",
        "filename": "cu_boulder_counseling.txt",
        "title": "Counseling & Psychiatric Services (CAPS)",
    },
    {
        "url": "https://www.colorado.edu/recreation",
        "filename": "cu_boulder_recreation.txt",
        "title": "Recreation Center",
    },
    {
        "url": "https://www.colorado.edu/libraries",
        "filename": "cu_boulder_libraries.txt",
        "title": "University Libraries",
    },
    {
        "url": "https://www.colorado.edu/orientation",
        "filename": "cu_boulder_orientation.txt",
        "title": "New Student & Family Programs",
    },
    {
        "url": "https://www.colorado.edu/pts",
        "filename": "cu_boulder_parking_transport.txt",
        "title": "Parking & Transportation",
    },
    {
        "url": "https://www.colorado.edu/dining",
        "filename": "cu_boulder_dining.txt",
        "title": "Dining Services",
    },
    {
        "url": "https://www.colorado.edu/engineering",
        "filename": "cu_boulder_engineering.txt",
        "title": "College of Engineering & Applied Science",
    },
    {
        "url": "https://www.colorado.edu/artsandsciences",
        "filename": "cu_boulder_arts_sciences.txt",
        "title": "College of Arts and Sciences",
    },
    {
        "url": "https://www.colorado.edu/business",
        "filename": "cu_boulder_business.txt",
        "title": "Leeds School of Business",
    },
]


def _html_to_text(html: str) -> str:
    """Lightweight HTML-to-text conversion: strip tags, collapse whitespace."""
    text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.S)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.S)
    text = re.sub(r"<nav[^>]*>.*?</nav>", "", text, flags=re.S)
    text = re.sub(r"<footer[^>]*>.*?</footer>", "", text, flags=re.S)
    text = re.sub(r"<header[^>]*>.*?</header>", "", text, flags=re.S)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&#\d+;", "", text)
    text = re.sub(r"&\w+;", "", text)
    lines = [line.strip() for line in text.splitlines()]
    lines = [l for l in lines if l]
    deduped: List[str] = []
    for line in lines:
        if not deduped or line != deduped[-1]:
            deduped.append(line)
    return "\n".join(deduped)


async def _fetch_page(
    client: httpx.AsyncClient, url: str
) -> Optional[str]:
    """Fetch a single page and return cleaned text, or None on failure."""
    try:
        resp = await client.get(
            url, headers={"User-Agent": BROWSER_UA}, follow_redirects=True
        )
        if resp.status_code != 200:
            LOG.warning(f"CU info page {url} returned {resp.status_code}")
            return None
        return _html_to_text(resp.text)
    except Exception as e:
        LOG.warning(f"Failed to fetch {url}: {e}")
        return None


async def scrape_cu_info(data_dir: str = "./data") -> int:
    """Scrape key colorado.edu pages and save as text files in *data_dir*.

    Returns the number of pages successfully saved.
    """
    out = Path(data_dir)
    out.mkdir(exist_ok=True)

    saved = 0
    async with httpx.AsyncClient(timeout=30) as client:
        for page in PAGES:
            text = await _fetch_page(client, page["url"])
            if not text or len(text.strip()) < 100:
                LOG.warning(
                    f"Skipping {page['url']} — insufficient content"
                )
                continue

            header = (
                f"# {page['title']}\n"
                f"Source: {page['url']}\n\n"
            )
            filepath = out / page["filename"]
            filepath.write_text(header + text, encoding="utf-8")
            saved += 1
            LOG.info(
                f"Saved {page['filename']} ({len(text)} chars)"
            )

    LOG.info(f"CU info scrape complete: {saved}/{len(PAGES)} pages saved")
    return saved


async def run_cu_info_scrape(data_dir: str = "./data") -> int:
    """Public entry point used by the scheduler."""
    return await scrape_cu_info(data_dir=data_dir)
