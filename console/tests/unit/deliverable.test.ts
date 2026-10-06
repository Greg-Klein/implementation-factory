import { describe, expect, it } from "@jest/globals";
import { branchFromCommand, createsMergeRequest, mergeRequestUrl } from "../../server/domain";

describe("run deliverable", () => {
  it("should read the branch name from the command that creates it", () => {
    expect(branchFromCommand("git checkout -b feat/258-notifications")).toBe("feat/258-notifications");
    expect(branchFromCommand("git switch -c feat/258-notifications")).toBe("feat/258-notifications");
    expect(branchFromCommand("git -C /tmp/repo switch --create feat/258")).toBe("feat/258");
    expect(branchFromCommand("git checkout -b 'feat/quoted branch'")).toBe("feat/quoted branch");
    expect(branchFromCommand('git checkout -b "feat/258" && npm test')).toBe("feat/258");
  });

  it("should read the branch name a shell variable assigned in the same command holds", () => {
    expect(branchFromCommand("B=feat-6005-banner; U=6050-umbrella\ngit show-ref refs/heads/$B\ngit switch -c $B --no-track origin/$U")).toBe("feat-6005-banner");
    expect(branchFromCommand('B="feat/258"; git checkout -b "${B}" && git status')).toBe("feat/258");
    expect(branchFromCommand("B=old; B=new; git switch -c $B")).toBe("new");
  });

  it("should read no branch when the name stays a shell expansion", () => {
    expect(branchFromCommand("git switch -c $B --no-track origin/develop")).toBeUndefined();
    expect(branchFromCommand('git checkout -b "feat-$ID"')).toBeUndefined();
    expect(branchFromCommand("git switch -c $(cat branch.txt)")).toBeUndefined();
    expect(branchFromCommand("B=$(cat branch.txt); git switch -c $B")).toBeUndefined();
  });

  it("should read no branch from a command that creates none", () => {
    expect(branchFromCommand("git checkout develop")).toBeUndefined();
    expect(branchFromCommand("glab issue view 258 | grep -b 3 branche")).toBeUndefined();
    expect(branchFromCommand(undefined)).toBeUndefined();
  });

  it("should recognise the commands that open a merge request", () => {
    expect(createsMergeRequest("glab mr create --fill")).toBe(true);
    expect(createsMergeRequest("gh pr create --title x")).toBe(true);
    expect(createsMergeRequest('glab api --method POST "projects/:fullpath/merge_requests" --field "title=feat: x"')).toBe(true);
    expect(createsMergeRequest("gh api --method POST repos/acme/app/pulls -f title=x")).toBe(true);
    expect(createsMergeRequest("glab mr view 128")).toBe(false);
    expect(createsMergeRequest("git push -u origin feat/258")).toBe(false);
    expect(createsMergeRequest(undefined)).toBe(false);
  });

  it("should not take a call nested under a merge request for its opening", () => {
    expect(createsMergeRequest('glab api --method POST projects/42/merge_requests/128/notes --field "body=@review.md"')).toBe(false);
    expect(createsMergeRequest('glab api --method PUT projects/42/merge_requests/128 --field "description=@mr.md"')).toBe(false);
    expect(createsMergeRequest("glab api projects/:fullpath/merge_requests")).toBe(false);
  });

  it("should find the merge request address in a tool response of any shape", () => {
    expect(mergeRequestUrl("Creating merge request...\nhttps://gitlab.com/acme/app/-/merge_requests/128\n"))
      .toBe("https://gitlab.com/acme/app/-/merge_requests/128");
    expect(mergeRequestUrl({ stdout: "https://gitlab.com/acme/-/merge_requests/7", stderr: "" }))
      .toBe("https://gitlab.com/acme/-/merge_requests/7");
    expect(mergeRequestUrl({ stdout: "https://github.com/acme/app/pull/12" }))
      .toBe("https://github.com/acme/app/pull/12");
    expect(mergeRequestUrl({
      stdout: '{"iid":128,"author":{"web_url":"https://gitlab.com/greg"},"web_url":"https://gitlab.com/acme/app/-/merge_requests/128"}',
    })).toBe("https://gitlab.com/acme/app/-/merge_requests/128");
  });

  it("should name the merge request that was created, not one its description cites", () => {
    expect(mergeRequestUrl({
      stdout: '{"iid":129,"description":"Stacked on https://gitlab.com/acme/app/-/merge_requests/128","web_url":"https://gitlab.com/acme/app/-/merge_requests/129","references":{"full":"acme/app!129"}}',
    })).toBe("https://gitlab.com/acme/app/-/merge_requests/129");
    expect(mergeRequestUrl({
      stdout: '{"number":13,"body":"Follows https://github.com/acme/app/pull/12","html_url":"https://github.com/acme/app/pull/13","url":"https://api.github.com/repos/acme/app/pulls/13"}',
    })).toBe("https://github.com/acme/app/pull/13");
    expect(mergeRequestUrl("Creating merge request for feat/x into main\nDescription: follows https://gitlab.com/acme/app/-/merge_requests/128\n\nhttps://gitlab.com/acme/app/-/merge_requests/129\n"))
      .toBe("https://gitlab.com/acme/app/-/merge_requests/129");
  });

  it("should read what the command printed before what the remote said beside it", () => {
    expect(mergeRequestUrl({
      stdout: "Creating merge request...\nhttps://gitlab.com/g/p/-/merge_requests/12\n",
      stderr: "remote: View merge request for parent:\nremote:   https://gitlab.com/g/p/-/merge_requests/5\n",
    })).toBe("https://gitlab.com/g/p/-/merge_requests/12");
    expect(mergeRequestUrl({ stdout: "", stderr: "remote: https://gitlab.com/g/p/-/merge_requests/5" })).toBe("https://gitlab.com/g/p/-/merge_requests/5");
    expect(mergeRequestUrl({
      stdout: '{"iid":129,"description":"Stacked on https://gitlab.com/acme/app/-/merge_requests/128","web_url":"https://gitlab.com/acme/app/-/merge_requests/129"}\n(1 request)\n',
    })).toBe("https://gitlab.com/acme/app/-/merge_requests/129");
  });

  it("should find no address when the response carries none", () => {
    expect(mergeRequestUrl("aborted: nothing to compare")).toBeUndefined();
    expect(mergeRequestUrl(undefined)).toBeUndefined();
    expect(mergeRequestUrl(null)).toBeUndefined();
  });
});
