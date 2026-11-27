"""Check the two production articles that the installed version will open."""
import re
import sys
from html.parser import HTMLParser
from urllib.request import Request, urlopen


class Article(HTMLParser):
    def __init__(self):
        super().__init__()
        self.metadata = {}
        self.canonical = None
        self.language = None

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "meta" and "property" in values:
            self.metadata[values["property"]] = values.get("content", "")
        elif tag == "link" and values.get("rel") == "canonical":
            self.canonical = values.get("href")
        elif tag == "html":
            self.language = values.get("lang")


def check(version, prefix, language):
    url = f"https://atd.best/{prefix}blog/atd-{version.replace('.', '-')}"
    request = Request(url, headers={"User-Agent": "Atd release verification"})
    with urlopen(request, timeout=20) as response:
        page = Article()
        page.feed(response.read().decode("utf-8"))
        if (response.status != 200 or response.geturl() != url or page.canonical != url
                or page.language != language or page.metadata.get("og:type") != "article"
                or not page.metadata.get("og:title", "").endswith(f"Atd {version}")):
            sys.exit(f"Expected the {language} release article for {version} at {url}")
    print(f"Verified {url}")


if __name__ == "__main__":
    version, = sys.argv[1:]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        sys.exit("Expected a stable version")
    check(version, "", "en")
    check(version, "zh/", "zh-CN")
