import * as vscode from 'vscode';
import { JestRunnerConfig } from './jestRunnerConfig';
import { exactRegexMatch, normalizePath, pushMany, quote, unquote } from './util';
// tslint:disable-next-line: no-var-requires
const escapeStringRegexp = require('escape-string-regexp');

export class JestRunner {
  private static readonly TEST_NAME_REGEX = /(it|test)\(("([^"]+)"|`([^`]+)`|'([^']+)'),/;
  private static readonly DESCRIBE_NAME_REGEX = /(describe)\(("([^"]+)"|`([^`]+)`|'([^']+)'),/;

  private previousCommand: string;

  private terminal: vscode.Terminal;

  private readonly config = new JestRunnerConfig();

  constructor() {
    this.setup();
  }

  //
  // public methods
  //

  public async runCurrentTest() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    const filePath = editor.document.fileName;
    const testName = this.findCurrentTestName(editor);
    const command = this.buildJestCommand(filePath, testName);

    this.previousCommand = command;

    await this.runTerminalCommand(command);
  }

  public async runCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    const filePath = editor.document.fileName;
    const command = this.buildJestCommand(filePath);

    this.previousCommand = command;

    await this.runTerminalCommand(command);
  }

  public async runPreviousTest() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    await this.runTerminalCommand(this.previousCommand);
  }

  public async debugCurrentTest() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    const config: vscode.DebugConfiguration = {
      console: 'integratedTerminal',
      internalConsoleOptions: 'neverOpen',
      name: 'Debug Jest Tests',
      program: this.config.jestBinPath,
      request: 'launch',
      type: 'node',
      ...this.config.debugOptions
    };
    config.args = config.args ? config.args.slice() : [];

    const filePath = editor.document.fileName;
    const testName = this.findCurrentTestName(editor);

    const standardArgs = this.buildJestArgs(filePath, testName, false);
    pushMany(config.args, standardArgs);

    config.args.push('--runInBand');

    vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(editor.document.uri), config);
  }

  //
  // private methods
  //

  private findCurrentTestName(editor: vscode.TextEditor): string {
    // from selection
    const { selection, document } = editor;
    if (!selection.isEmpty) {
      return unquote(document.getText(selection));
    }

    let testName = '';
    let testFound = false;
    // from cursor position
    for (let currentLine = selection.active.line; currentLine >= 0; currentLine--) {
      const text = document.getText(new vscode.Range(currentLine, 0, currentLine, 100000));
      const matchTest = JestRunner.TEST_NAME_REGEX.exec(text);
      const matchDescribe = JestRunner.DESCRIBE_NAME_REGEX.exec(text);
      if (matchDescribe) {
        if (testName) {
          return exactRegexMatch(escapeStringRegexp(unquote(matchDescribe[2]) + ' ' + testName));
        }
        return escapeStringRegexp(unquote(matchDescribe[2]));
      }
      if (matchTest && !testFound) {
        testFound = true;
        testName = unquote(matchTest[2]);
      }
      if (testFound && currentLine === 0) {
        return exactRegexMatch(escapeStringRegexp(testName));
      }
    }

    return '';
  }

  private buildJestCommand(filePath: string, testName?: string): string {
    const args = this.buildJestArgs(filePath, testName, true);
    return `cd ${quote(this.config.currentWorkspaceFolderPath)}; ${this.config.jestCommand} ${args.join(' ')}`;
  }

  private buildJestArgs(filePath: string, testName: string, withQuotes: boolean): string[] {
    const args: string[] = [];
    const quoter = withQuotes ? quote : str => str;

    args.push(quoter(normalizePath(filePath)));

    if (this.config.jestConfigPath) {
      args.push('-c');
      args.push(quoter(normalizePath(this.config.jestConfigPath)));
    }

    if (testName) {
      args.push('-t');
      args.push(quoter(testName));
    }

    if (this.config.runOptions) {
      args.push(...this.config.runOptions);
    }

    return args;
  }

  private async runTerminalCommand(command: string) {
    if (!this.terminal) {
      this.terminal = vscode.window.createTerminal('jest');
    }
    this.terminal.show();
    await vscode.commands.executeCommand('workbench.action.terminal.clear');
    this.terminal.sendText(command);
  }

  private setup() {
    vscode.window.onDidCloseTerminal(() => {
      this.terminal = null;
    });
  }
}
