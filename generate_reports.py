import re
import os

def parse_commits(filepath):
    commits = []
    with open(filepath, 'r') as f:
        content = f.read()
        blocks = content.split('\n* **')
        for block in blocks:
            if not block.strip():
                continue
            if not block.startswith('* **'):
                block = '* **' + block

            lines = block.split('\n')
            title_line = lines[0]
            body = '\n'.join(lines[1:]).strip()
            commits.append({'title': title_line, 'body': body})
    return commits

def generate_report(repo_name, period, filepath):
    commits = parse_commits(filepath)
    report = f"# Activity Report: {repo_name} ({period})\n\n"

    if not commits:
        report += "No commits found in this period.\n"
        return report

    report += f"## Total Commits: {len(commits)}\n\n"
    report += "## Summary of Changes\n\n"

    for commit in commits:
        report += f"{commit['title']}\n"
        if commit['body']:
            report += f"{commit['body']}\n"
        report += "\n"

    return report

periods = [
    ('4 Days', '4_days'),
    ('7 Days', '7_days'),
    ('All Time', 'all_time')
]

for title, suffix in periods:
    coll_report = generate_report('collective', title, f'collective_{suffix}_commits.txt')
    with open(f'report_collective_{suffix}.md', 'w') as f:
        f.write(coll_report)

    code_report = generate_report('docs/codebase-analysis-collective', title, f'codebase_{suffix}_commits.txt')
    with open(f'report_codebase_analysis_collective_{suffix}.md', 'w') as f:
        f.write(code_report)
