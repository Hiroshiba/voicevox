/**
 * 引数などを解析して、最初に開かれるべきファイルを決定する。
 *
 * NOTE: macOSの場合は'open-file'イベントでファイルパスを受け取る。
 * https://www.electronjs.org/docs/latest/api/app#event-open-file-macos
 */

export class InitialFileHelper {
  private readonly processArgv: string[];
  private readonly isProduction: boolean;
  private readonly isMac: boolean;

  private filePathFromOpenFileEvent: string | undefined = undefined;

  constructor(params: {
    processArgv: string[];
    isProduction: boolean;
    isMac: boolean;
  }) {
    this.processArgv = params.processArgv;
    this.isProduction = params.isProduction;
    this.isMac = params.isMac;
  }

  /**
   * 製品版でmacOS以外の場合、引数はargv[1]以降をそのまま返す。
   * 開発版の場合、引数は`--`がある場合は`--`以降を返す。
   * それ以外の場合は空配列を返す。
   */
  private getArgv(): string[] {
    if (this.isProduction) {
      if (!this.isMac) {
        return this.processArgv.slice(1);
      }
    } else {
      const index = this.processArgv.indexOf("--");
      if (index !== -1) {
        return this.processArgv.slice(index + 1);
      }
    }
    return [];
  }

  /**
   * 'open-file'イベントで受け取ったファイルパスを設定する。
   */
  setFilePathFromOpenFileEvent(filePath: string): void {
    this.filePathFromOpenFileEvent = filePath;
  }

  /**
   * ファイルパスを取得する。
   */
  getFilePath(): string | undefined {
    const { filePathFromOpenFileEvent } = this;
    if (filePathFromOpenFileEvent != undefined) {
      return filePathFromOpenFileEvent;
    }

    const argv = this.getArgv();
    if (argv.length > 0) {
      return argv[0];
    }

    return undefined;
  }
}
