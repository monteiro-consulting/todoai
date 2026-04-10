"""
Stack detection service: analyzes project files to infer
the tech stack, project type, and main dependencies.
"""

import json
import re
from pathlib import Path


# --- Project type inference rules ---
# Each rule: (condition_fn, project_type, confidence_boost)
# condition_fn receives the detection context dict built during scanning.

_PROJECT_TYPE_RULES: list[tuple[str, callable]] = []  # populated below


def _rule(project_type: str):
    """Decorator to register a project-type inference rule."""
    def decorator(fn):
        _PROJECT_TYPE_RULES.append((project_type, fn))
        return fn
    return decorator


@_rule("monorepo")
def _is_monorepo(ctx: dict) -> bool:
    markers = ctx["marker_files"]
    pkg = ctx.get("package_json") or {}
    return (
        "lerna.json" in markers
        or "pnpm-workspace.yaml" in markers
        or "turbo.json" in markers
        or "nx.json" in markers
        or bool(pkg.get("workspaces"))
    )


@_rule("web-app")
def _is_web_app(ctx: dict) -> bool:
    frameworks = ctx["frameworks"]
    return bool({"React", "Vue", "Svelte", "Angular", "Next.js", "Nuxt", "SvelteKit"} & frameworks)


@_rule("api")
def _is_api(ctx: dict) -> bool:
    frameworks = ctx["frameworks"]
    return bool({"FastAPI", "Express", "Fastify", "Django REST", "Flask", "Gin", "Actix", "Spring Boot", "Rails"} & frameworks)


@_rule("mobile-app")
def _is_mobile(ctx: dict) -> bool:
    frameworks = ctx["frameworks"]
    return bool({"React Native", "Flutter", "Expo"} & frameworks)


@_rule("desktop-app")
def _is_desktop(ctx: dict) -> bool:
    frameworks = ctx["frameworks"]
    return bool({"Electron", "Tauri"} & frameworks)


@_rule("cli")
def _is_cli(ctx: dict) -> bool:
    markers = ctx["marker_files"]
    pkg = ctx.get("package_json") or {}
    has_bin = bool(pkg.get("bin"))
    cargo = ctx.get("cargo_toml") or {}
    # Rust binary without lib.rs
    is_rust_bin = bool(cargo) and "src/main.rs" in ctx.get("files_at_root", set())
    return has_bin or is_rust_bin


@_rule("library")
def _is_library(ctx: dict) -> bool:
    pkg = ctx.get("package_json") or {}
    cargo = ctx.get("cargo_toml") or {}
    pyproject = ctx.get("pyproject_toml") or {}
    has_main = bool(pkg.get("main") or pkg.get("exports") or pkg.get("module"))
    has_lib_rs = "src/lib.rs" in ctx.get("files_at_root", set())
    has_py_build = bool(
        pyproject.get("build-system")
        or pyproject.get("tool", {}).get("poetry", {}).get("packages")
        or pyproject.get("project", {}).get("scripts") is None
        and pyproject.get("project", {}).get("name")
    )
    # Library if it looks publishable and has no web framework
    web = {"React", "Vue", "Svelte", "Angular", "Next.js", "Nuxt"}
    no_web = not (web & ctx["frameworks"])
    return (has_main or has_lib_rs or has_py_build) and no_web


# --- Dependency file parsers ---

def _parse_package_json(path: Path) -> dict:
    """Extract info from package.json."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data


def _parse_requirements_txt(path: Path) -> list[str]:
    """Extract package names from requirements.txt."""
    deps = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("-"):
                continue
            # Strip version specifiers: package>=1.0 -> package
            name = re.split(r"[>=<!\[;@\s]", line)[0].strip()
            if name:
                deps.append(name.lower())
    except OSError:
        pass
    return deps


def _parse_pyproject_toml(path: Path) -> dict:
    """Extract basic info from pyproject.toml (simple parser, no toml lib needed)."""
    result: dict = {"dependencies": [], "dev_dependencies": [], "raw": {}}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return result

    # Try to use tomllib (Python 3.11+) or fallback to regex
    try:
        import tomllib
        data = tomllib.loads(text)
        result["raw"] = data

        # PEP 621 dependencies
        for dep in data.get("project", {}).get("dependencies", []):
            name = re.split(r"[>=<!\[;@\s]", dep)[0].strip()
            if name:
                result["dependencies"].append(name.lower())

        # Poetry dependencies
        poetry_deps = data.get("tool", {}).get("poetry", {}).get("dependencies", {})
        for name in poetry_deps:
            if name.lower() != "python":
                result["dependencies"].append(name.lower())

        poetry_dev = data.get("tool", {}).get("poetry", {}).get("group", {}).get("dev", {}).get("dependencies", {})
        for name in poetry_dev:
            result["dev_dependencies"].append(name.lower())

    except (ImportError, Exception):
        # Fallback: regex extraction for dependency lines
        for m in re.finditer(r'^\s*"?([a-zA-Z0-9_-]+)"?\s*[>=<]', text, re.MULTILINE):
            name = m.group(1).lower()
            if name != "python":
                result["dependencies"].append(name)

    return result


def _parse_cargo_toml(path: Path) -> dict:
    """Extract basic info from Cargo.toml."""
    result: dict = {"dependencies": [], "raw": {}}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return result

    try:
        import tomllib
        data = tomllib.loads(text)
        result["raw"] = data
        for name in data.get("dependencies", {}):
            result["dependencies"].append(name)
        for name in data.get("dev-dependencies", {}):
            result["dependencies"].append(name)
    except (ImportError, Exception):
        # Fallback: regex for [dependencies] section entries
        in_deps = False
        for line in text.splitlines():
            if re.match(r"\[(.*dependencies.*)\]", line):
                in_deps = True
                continue
            if line.startswith("["):
                in_deps = False
                continue
            if in_deps:
                m = re.match(r"^([a-zA-Z0-9_-]+)\s*=", line)
                if m:
                    result["dependencies"].append(m.group(1))

    return result


def _parse_go_mod(path: Path) -> list[str]:
    """Extract module dependencies from go.mod."""
    deps = []
    try:
        text = path.read_text(encoding="utf-8")
        in_require = False
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("require ("):
                in_require = True
                continue
            if in_require and line == ")":
                in_require = False
                continue
            if in_require:
                parts = line.split()
                if parts:
                    deps.append(parts[0])
            elif line.startswith("require "):
                parts = line.split()
                if len(parts) >= 2:
                    deps.append(parts[1])
    except OSError:
        pass
    return deps


def _parse_gemfile(path: Path) -> list[str]:
    """Extract gem names from Gemfile."""
    gems = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"""^\s*gem\s+['"]([a-zA-Z0-9_-]+)['"]""", line)
            if m:
                gems.append(m.group(1))
    except OSError:
        pass
    return gems


def _parse_composer_json(path: Path) -> dict:
    """Extract dependencies from composer.json."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {
            "dependencies": list(data.get("require", {}).keys()),
            "dev_dependencies": list(data.get("require-dev", {}).keys()),
        }
    except (OSError, json.JSONDecodeError):
        return {"dependencies": [], "dev_dependencies": []}


# --- Framework detection from dependencies ---

_JS_FRAMEWORK_MAP: dict[str, str] = {
    "react": "React",
    "react-dom": "React",
    "next": "Next.js",
    "vue": "Vue",
    "nuxt": "Nuxt",
    "svelte": "Svelte",
    "@sveltejs/kit": "SvelteKit",
    "angular": "Angular",
    "@angular/core": "Angular",
    "express": "Express",
    "fastify": "Fastify",
    "koa": "Koa",
    "hono": "Hono",
    "electron": "Electron",
    "@tauri-apps/api": "Tauri",
    "react-native": "React Native",
    "expo": "Expo",
    "three": "Three.js",
    "gatsby": "Gatsby",
    "remix": "Remix",
    "@remix-run/react": "Remix",
    "astro": "Astro",
}

_JS_BUILD_TOOLS: dict[str, str] = {
    "vite": "Vite",
    "webpack": "webpack",
    "esbuild": "esbuild",
    "rollup": "Rollup",
    "parcel": "Parcel",
    "turbo": "Turborepo",
    "tsup": "tsup",
    "swc": "SWC",
    "@swc/core": "SWC",
}

_JS_TEST_TOOLS: dict[str, str] = {
    "vitest": "Vitest",
    "jest": "Jest",
    "mocha": "Mocha",
    "cypress": "Cypress",
    "playwright": "Playwright",
    "@playwright/test": "Playwright",
    "@testing-library/react": "Testing Library",
}

_JS_STYLE_TOOLS: dict[str, str] = {
    "tailwindcss": "Tailwind CSS",
    "sass": "Sass",
    "styled-components": "styled-components",
    "@emotion/react": "Emotion",
    "postcss": "PostCSS",
}

_JS_ORM_TOOLS: dict[str, str] = {
    "prisma": "Prisma",
    "@prisma/client": "Prisma",
    "drizzle-orm": "Drizzle",
    "typeorm": "TypeORM",
    "sequelize": "Sequelize",
    "mongoose": "Mongoose",
    "knex": "Knex",
}

_PY_FRAMEWORK_MAP: dict[str, str] = {
    "fastapi": "FastAPI",
    "flask": "Flask",
    "django": "Django",
    "djangorestframework": "Django REST",
    "starlette": "Starlette",
    "tornado": "Tornado",
    "sanic": "Sanic",
    "litestar": "Litestar",
    "streamlit": "Streamlit",
    "gradio": "Gradio",
}

_PY_TEST_TOOLS: dict[str, str] = {
    "pytest": "pytest",
    "unittest": "unittest",
    "tox": "tox",
    "nox": "nox",
    "hypothesis": "Hypothesis",
}

_PY_ORM_TOOLS: dict[str, str] = {
    "sqlalchemy": "SQLAlchemy",
    "sqlmodel": "SQLModel",
    "tortoise-orm": "Tortoise ORM",
    "peewee": "Peewee",
    "alembic": "Alembic",
}


# --- Main detection function ---

def detect_stack(path: str) -> dict:
    """Detect the tech stack, project type, and main dependencies from a project directory.

    Args:
        path: Absolute path to the project root.

    Returns a dict with:
        - ``project_types``: list of inferred project types (e.g. ["web-app", "api"])
        - ``primary_language``: best-guess main language
        - ``languages``: list of detected programming languages
        - ``frameworks``: list of detected frameworks
        - ``build_tools``: list of detected build tools
        - ``test_tools``: list of detected testing tools
        - ``styling``: list of detected CSS/styling tools
        - ``orm_db``: list of detected ORM / database tools
        - ``infrastructure``: list of infra tools (Docker, CI, etc.)
        - ``package_managers``: list of detected package managers
        - ``dependencies``: dict with "production" and "dev" lists
        - ``meta``: dict with project name, version, description if found
    """
    root = Path(path)
    if not root.is_dir():
        return _empty_result(f"Path '{path}' does not exist or is not a directory")

    # --- Phase 1: Discover marker files at root ---
    marker_files: set[str] = set()
    files_at_root: set[str] = set()
    try:
        for entry in root.iterdir():
            if entry.is_file():
                marker_files.add(entry.name)
            elif entry.is_dir():
                # Check a few key nested paths
                for sub in ("src/main.rs", "src/lib.rs"):
                    if (root / sub).is_file():
                        files_at_root.add(sub)
    except PermissionError:
        return _empty_result(f"Permission denied reading '{path}'")

    # Also check common nested config locations
    for nested in ("src/main.rs", "src/lib.rs", "src/index.ts", "src/index.js",
                    "src/App.tsx", "src/app.py", "cmd/main.go"):
        if (root / nested).is_file():
            files_at_root.add(nested)

    # --- Phase 2: Parse dependency files ---
    languages: set[str] = set()
    frameworks: set[str] = set()
    build_tools: set[str] = set()
    test_tools: set[str] = set()
    styling: set[str] = set()
    orm_db: set[str] = set()
    infrastructure: set[str] = set()
    package_managers: set[str] = set()
    prod_deps: list[str] = []
    dev_deps: list[str] = []
    meta: dict = {}

    pkg_json = None
    pyproject_data = None
    cargo_data = None

    # -- package.json --
    pkg_path = root / "package.json"
    if pkg_path.is_file():
        pkg_json = _parse_package_json(pkg_path)
        if pkg_json:
            languages.add("JavaScript")
            if "tsconfig.json" in marker_files or "tsconfig.json" in {e.name for e in root.iterdir() if e.is_file()}:
                languages.add("TypeScript")

            meta["name"] = pkg_json.get("name", "")
            meta["version"] = pkg_json.get("version", "")
            meta["description"] = pkg_json.get("description", "")

            all_deps = pkg_json.get("dependencies", {})
            all_dev = pkg_json.get("devDependencies", {})
            prod_deps.extend(all_deps.keys())
            dev_deps.extend(all_dev.keys())

            combined = {**all_deps, **all_dev}
            for dep in combined:
                dep_lower = dep.lower()
                if dep_lower in _JS_FRAMEWORK_MAP:
                    frameworks.add(_JS_FRAMEWORK_MAP[dep_lower])
                if dep_lower in _JS_BUILD_TOOLS:
                    build_tools.add(_JS_BUILD_TOOLS[dep_lower])
                if dep_lower in _JS_TEST_TOOLS:
                    test_tools.add(_JS_TEST_TOOLS[dep_lower])
                if dep_lower in _JS_STYLE_TOOLS:
                    styling.add(_JS_STYLE_TOOLS[dep_lower])
                if dep_lower in _JS_ORM_TOOLS:
                    orm_db.add(_JS_ORM_TOOLS[dep_lower])
                if dep == "typescript":
                    languages.add("TypeScript")

            # Package manager detection
            if (root / "pnpm-lock.yaml").is_file():
                package_managers.add("pnpm")
            elif (root / "yarn.lock").is_file():
                package_managers.add("yarn")
            elif (root / "bun.lockb").is_file() or (root / "bun.lock").is_file():
                package_managers.add("bun")
            elif (root / "package-lock.json").is_file():
                package_managers.add("npm")
            else:
                package_managers.add("npm")

    # -- tsconfig.json --
    if "tsconfig.json" in marker_files:
        languages.add("TypeScript")

    # -- requirements.txt --
    req_path = root / "requirements.txt"
    if req_path.is_file():
        languages.add("Python")
        package_managers.add("pip")
        py_deps = _parse_requirements_txt(req_path)
        prod_deps.extend(py_deps)
        for dep in py_deps:
            if dep in _PY_FRAMEWORK_MAP:
                frameworks.add(_PY_FRAMEWORK_MAP[dep])
            if dep in _PY_TEST_TOOLS:
                test_tools.add(_PY_TEST_TOOLS[dep])
            if dep in _PY_ORM_TOOLS:
                orm_db.add(_PY_ORM_TOOLS[dep])

    # -- pyproject.toml --
    pyproject_path = root / "pyproject.toml"
    if pyproject_path.is_file():
        languages.add("Python")
        pyproject_data = _parse_pyproject_toml(pyproject_path)
        raw = pyproject_data.get("raw", {})

        if not meta.get("name"):
            meta["name"] = raw.get("project", {}).get("name", "")
            meta["version"] = raw.get("project", {}).get("version", "")
            meta["description"] = raw.get("project", {}).get("description", "")

        for dep in pyproject_data.get("dependencies", []):
            if dep not in prod_deps:
                prod_deps.append(dep)
            if dep in _PY_FRAMEWORK_MAP:
                frameworks.add(_PY_FRAMEWORK_MAP[dep])
            if dep in _PY_TEST_TOOLS:
                test_tools.add(_PY_TEST_TOOLS[dep])
            if dep in _PY_ORM_TOOLS:
                orm_db.add(_PY_ORM_TOOLS[dep])

        for dep in pyproject_data.get("dev_dependencies", []):
            if dep not in dev_deps:
                dev_deps.append(dep)

        # Detect package manager
        if "Pipfile" in marker_files:
            package_managers.add("pipenv")
        elif raw.get("tool", {}).get("poetry"):
            package_managers.add("poetry")
        elif raw.get("tool", {}).get("pdm"):
            package_managers.add("pdm")
        elif "pip" not in package_managers:
            package_managers.add("pip")

    # -- Pipfile --
    if "Pipfile" in marker_files:
        languages.add("Python")
        package_managers.add("pipenv")

    # -- Cargo.toml --
    cargo_path = root / "Cargo.toml"
    if cargo_path.is_file():
        languages.add("Rust")
        package_managers.add("cargo")
        cargo_data = _parse_cargo_toml(cargo_path)
        raw = cargo_data.get("raw", {})

        if not meta.get("name"):
            pkg_section = raw.get("package", {})
            meta["name"] = pkg_section.get("name", "")
            meta["version"] = pkg_section.get("version", "")
            meta["description"] = pkg_section.get("description", "")

        prod_deps.extend(cargo_data.get("dependencies", []))

        # Detect Rust frameworks
        rust_fw = {
            "actix-web": "Actix", "axum": "Axum", "rocket": "Rocket",
            "warp": "Warp", "tide": "Tide", "tauri": "Tauri",
            "leptos": "Leptos", "yew": "Yew", "dioxus": "Dioxus",
        }
        for dep in cargo_data.get("dependencies", []):
            if dep in rust_fw:
                frameworks.add(rust_fw[dep])
            if dep == "tokio":
                build_tools.add("Tokio")

    # -- go.mod --
    go_mod_path = root / "go.mod"
    if go_mod_path.is_file():
        languages.add("Go")
        package_managers.add("go modules")
        go_deps = _parse_go_mod(go_mod_path)
        prod_deps.extend(go_deps)

        go_fw = {
            "github.com/gin-gonic/gin": "Gin",
            "github.com/labstack/echo": "Echo",
            "github.com/gofiber/fiber": "Fiber",
            "github.com/gorilla/mux": "Gorilla Mux",
        }
        for dep in go_deps:
            for prefix, fw in go_fw.items():
                if dep.startswith(prefix):
                    frameworks.add(fw)

    # -- Gemfile --
    gemfile_path = root / "Gemfile"
    if gemfile_path.is_file():
        languages.add("Ruby")
        package_managers.add("bundler")
        gems = _parse_gemfile(gemfile_path)
        prod_deps.extend(gems)
        if "rails" in gems:
            frameworks.add("Rails")
        if "sinatra" in gems:
            frameworks.add("Sinatra")
        if "rspec" in gems or "rspec-rails" in gems:
            test_tools.add("RSpec")

    # -- composer.json --
    composer_path = root / "composer.json"
    if composer_path.is_file():
        languages.add("PHP")
        package_managers.add("composer")
        composer_data = _parse_composer_json(composer_path)
        prod_deps.extend(composer_data.get("dependencies", []))
        dev_deps.extend(composer_data.get("dev_dependencies", []))
        for dep in composer_data.get("dependencies", []):
            if "laravel/framework" in dep:
                frameworks.add("Laravel")
            if "symfony/" in dep:
                frameworks.add("Symfony")

    # -- Java: pom.xml / build.gradle --
    if "pom.xml" in marker_files:
        languages.add("Java")
        build_tools.add("Maven")
        package_managers.add("maven")
    if "build.gradle" in marker_files or "build.gradle.kts" in marker_files:
        languages.add("Java")
        build_tools.add("Gradle")
        package_managers.add("gradle")
        if "build.gradle.kts" in marker_files:
            languages.add("Kotlin")

    # -- Infrastructure --
    if "Dockerfile" in marker_files:
        infrastructure.add("Docker")
    if "docker-compose.yml" in marker_files or "docker-compose.yaml" in marker_files:
        infrastructure.add("Docker Compose")
    if (root / ".github" / "workflows").is_dir():
        infrastructure.add("GitHub Actions")
    if ".gitlab-ci.yml" in marker_files:
        infrastructure.add("GitLab CI")
    if "Jenkinsfile" in marker_files:
        infrastructure.add("Jenkins")
    if ".circleci" in {e.name for e in root.iterdir() if e.is_dir()}:
        infrastructure.add("CircleCI")
    if "vercel.json" in marker_files:
        infrastructure.add("Vercel")
    if "netlify.toml" in marker_files:
        infrastructure.add("Netlify")
    if "fly.toml" in marker_files:
        infrastructure.add("Fly.io")
    if "terraform" in {e.name for e in root.iterdir() if e.is_dir()} or any(
        f.endswith(".tf") for f in marker_files
    ):
        infrastructure.add("Terraform")

    # -- Build tools from marker files --
    if "Makefile" in marker_files:
        build_tools.add("Make")
    if "CMakeLists.txt" in marker_files:
        build_tools.add("CMake")
        languages.add("C/C++")
    if "webpack.config.js" in marker_files or "webpack.config.ts" in marker_files:
        build_tools.add("webpack")
    if "vite.config.ts" in marker_files or "vite.config.js" in marker_files:
        build_tools.add("Vite")
    if "rollup.config.js" in marker_files or "rollup.config.mjs" in marker_files:
        build_tools.add("Rollup")

    # -- Django special case --
    if "manage.py" in marker_files:
        frameworks.add("Django")
        languages.add("Python")

    # --- Phase 3: Infer project type ---
    ctx = {
        "marker_files": marker_files,
        "files_at_root": files_at_root,
        "frameworks": frameworks,
        "languages": languages,
        "package_json": pkg_json,
        "pyproject_toml": pyproject_data,
        "cargo_toml": cargo_data,
    }

    project_types: list[str] = []
    for ptype, rule_fn in _PROJECT_TYPE_RULES:
        try:
            if rule_fn(ctx):
                project_types.append(ptype)
        except Exception:
            continue

    if not project_types:
        project_types.append("unknown")

    # --- Phase 4: Determine primary language ---
    primary_language = _guess_primary_language(languages, frameworks, pkg_json)

    # --- Phase 5: Build result ---
    return {
        "project_types": project_types,
        "primary_language": primary_language,
        "languages": sorted(languages),
        "frameworks": sorted(frameworks),
        "build_tools": sorted(build_tools),
        "test_tools": sorted(test_tools),
        "styling": sorted(styling),
        "orm_db": sorted(orm_db),
        "infrastructure": sorted(infrastructure),
        "package_managers": sorted(package_managers),
        "dependencies": {
            "production": prod_deps[:80],
            "dev": dev_deps[:40],
        },
        "meta": meta,
    }


def _guess_primary_language(
    languages: set[str],
    frameworks: set[str],
    pkg_json: dict | None,
) -> str:
    """Heuristic to pick the primary language."""
    if not languages:
        return "unknown"
    if len(languages) == 1:
        return next(iter(languages))

    # TypeScript > JavaScript when both present
    if "TypeScript" in languages and "JavaScript" in languages:
        languages.discard("JavaScript")

    # If a framework strongly implies a language, boost it
    py_frameworks = {"FastAPI", "Flask", "Django", "Django REST", "Starlette", "Streamlit", "Gradio"}
    if py_frameworks & frameworks:
        return "Python"
    js_frameworks = {"React", "Vue", "Svelte", "Angular", "Next.js", "Nuxt", "Express", "Fastify"}
    ts_implied = {"TypeScript"} & languages
    if js_frameworks & frameworks and ts_implied:
        return "TypeScript"
    if js_frameworks & frameworks:
        return "JavaScript"
    rust_frameworks = {"Actix", "Axum", "Rocket", "Tauri", "Leptos", "Yew"}
    if rust_frameworks & frameworks:
        return "Rust"
    go_frameworks = {"Gin", "Echo", "Fiber"}
    if go_frameworks & frameworks:
        return "Go"

    # Fallback: pick from priority order
    for lang in ("TypeScript", "Python", "Rust", "Go", "Java", "Kotlin", "Ruby", "PHP", "C/C++"):
        if lang in languages:
            return lang

    return next(iter(languages))


def _empty_result(error: str) -> dict:
    """Return an empty detection result with an error message."""
    return {
        "project_types": ["unknown"],
        "primary_language": "unknown",
        "languages": [],
        "frameworks": [],
        "build_tools": [],
        "test_tools": [],
        "styling": [],
        "orm_db": [],
        "infrastructure": [],
        "package_managers": [],
        "dependencies": {"production": [], "dev": []},
        "meta": {},
        "error": error,
    }
