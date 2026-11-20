from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_FILES = {
    ".gitignore", "bridge.cjs", "discord.example.yaml", "doctor.sh", "install.sh",
    "lib/config.cjs", "lib/omb.cjs", "lib/queue.cjs", "lib/route.cjs",
    "lib/split.cjs", "lib/store.cjs", "package.json", "package-lock.json",
    "process.yaml", "runtime.sh", "secrets.yaml", "setup.yaml", "tools.cjs",
}


def test_copier_writes_only_extension_slots(tmp_path):
    base = tmp_path / ".copier-answers.yml"
    base.write_text("project_slug: fixture\nport_base: 18540\n")
    ignore = tmp_path / ".gitignore"
    ignore.write_text("existing-ignore\n")

    subprocess.run(
        ["copier", "copy", "--trust", "--vcs-ref", "HEAD", str(ROOT), str(tmp_path)],
        check=True,
    )

    files = {p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*") if p.is_file()}
    assert files == {
        ".copier-answers.yml", ".gitignore", ".copier-answers.ext-discord.yml",
        ".config/mise/conf.d/ext-discord.toml",
    } | {f"extensions/discord/{name}" for name in RUNTIME_FILES}
    assert base.read_text() == "project_slug: fixture\nport_base: 18540\n"
    assert ignore.read_text() == "existing-ignore\n"
    secrets = (tmp_path / "extensions/discord/secrets.yaml").read_text()
    assert "- name: DISCORD_BOT_TOKEN" in secrets
    assert "required: true" in secrets
    assert "url: https://discord.com/developers/applications" in secrets
