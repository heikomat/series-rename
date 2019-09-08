import {promises as fsPromises} from 'fs';
import {Select, Input, Confirm} from 'enquirer/lib/prompts';
import path from 'path';
import rimraf from 'rimraf';
import tvdbjs from 'tvdb.js';

type KeyPressData = {
  sequence: string,
  name: string,
  ctrl: boolean,
  meta: boolean,
  shift: boolean,
};

const tv = tvdbjs(process.env.TVDB_API_KEY);

const videoFileExtensions = ['.mp4', '.mkv', '.avi'];

export class FileBrowser {

  private startDirectory: string;
  private currentDirectory: string;
  private highlightedFolder: string = '..';
  private currentPrompt:
    'folder-selection'
    | 'rename'
    | 'create-folder'
    | 'delete-folder'
    | 'series-language'
    | 'series-name'
    | 'series-suggestions'
    | 'episode-renames'
    | 'assign-episode'
    | 'move-folder'
    | 'non-video-purge'
    | 'hoist-files';

  private filesPrompt: Select;
  private confirmDeletePrompt: Confirm;
  private confirmHoistPrompt: Confirm;
  private moveFolderPrompt: Select;
  private confirmPurgePrompt: Confirm;


  private currentFolderToMove: string;
  private currentMoveTarget: string;

  private currentSeriesDirectory: string;
  private currentSeriesLanguage: string;
  private currentSeriesName: string;
  private currentSeries: any;
  private currentEpisodeRenames: Array<any>;

  constructor(startDirectory: string = process.cwd()) {
    this.startDirectory = startDirectory;
    this.currentDirectory = this.startDirectory;
  }

  public async start(): Promise<void> {
    process.stdin.on('keypress', this.handleKeyPress);
    this.promptMainMenu();
  }

  private async promptMainMenu(): Promise<void> {
    this.currentPrompt = 'folder-selection';
    const [files, folders] = await Promise.all([
      this.getFileNames(this.currentDirectory),
      this.getFolderNames(this.currentDirectory),
    ])

    const folderOptions = folders.map((folderName: string) => {
      return {name: folderName, message: folderName, value: folderName, disabled: false}
    });

    const fileOptopns = files.map((folderName: string) => {
      return {name: folderName, message: folderName, value: folderName, disabled: ''}
    });

    const options = [
      {name: '..', message: '..', value: '..'},
      ...folderOptions,
      ...fileOptopns,
    ]

    this.filesPrompt = new Select({
      name: 'selectedFolder',
      message: null,
      choices: options,
      header: this.currentDirectory,
      initial: this.highlightedFolder,
      footer: '[R]ename, [C]reate folder, [D]elete, [M]ove, [U]pdate, [H]oist files, [P]urge non-videos, [S]tandardize names, [E]xit',
    });

    console.clear();
    const selectedFolder = await this.filesPrompt.run();
    if (selectedFolder === '..') {
      this.highlightedFolder = path.basename(this.currentDirectory);
    } else {
      this.highlightedFolder = '..';
    }
    this.currentDirectory = path.join(this.currentDirectory, selectedFolder);
    this.promptMainMenu();
  }

  private async promptRename(filePath: string) {
    this.currentPrompt = 'rename';

    const directory = path.dirname(filePath);
    const filename = path.basename(filePath);

    const renamePrompt = new Input({
      name: 'rename',
      message: `rename ${filename}`,
      header: directory,
      footer: 'esc = abort',
      initial: filename,
    });

    console.clear();
    try {
      const newName = await renamePrompt.run();
      const oldPath = path.join(directory, filename);
      const newPath = path.join(directory, newName);
      await fsPromises.rename(oldPath, newPath);
      this.highlightedFolder = newName;
    } catch (error) {
      // probably just aborted
    }

    this.promptMainMenu();
  }

  private async promptCreateFolder(targetDirectory: string) {
    this.currentPrompt = 'create-folder';

    const createFolderPrompt = new Input({
      name: 'new folder',
      message: 'name',
      header: targetDirectory,
      footer: 'esc = abort',
    });

    console.clear();
    try {
      const folderName = await createFolderPrompt.run();
      await fsPromises.mkdir(path.join(targetDirectory, folderName));
      this.highlightedFolder = folderName;
    } catch (error) {
      // probably just aborted
    }

    this.promptMainMenu();
  }

  private async promptDeleteFolder(filePath: string) {
    this.currentPrompt = 'delete-folder';

    this.confirmDeletePrompt = new Confirm({
      message: `deleting ${filePath}. Are you sure?`,
      footer: 'esc = abort',
    });

    console.clear();
    try {
      const userAgreed = await this.confirmDeletePrompt.run();
      if (userAgreed) {
        await new Promise((resolve) => {
          rimraf(filePath, resolve);
        })
        this.highlightedFolder = '..';
      }
    } catch (error) {
      // probably just aborted
    }

    this.promptMainMenu();
  }

  private async hoistFiles(directory: string) {
    this.currentPrompt = 'hoist-files';
    const files = await this.getAllFilesInFolder(directory);
    console.clear();
    this.confirmHoistPrompt = new Confirm({
      message: `hoisting ${files.length} files. Are you sure?`,
      footer: 'esc = abort',
    });

    try {
      const userAgreed = await this.confirmHoistPrompt.run();
      if (userAgreed) {
        // move all children to the target directory
        await Promise.all(files.map((filePath: string) => {
          const filename = path.basename(filePath);
          const targetFile = path.join(directory, filename);
          if (filePath === targetFile) {
            return undefined;
          }

          return fsPromises.rename(filePath, targetFile);
        }));

        // delete all the now empty folders
        const remainingFolders = await this.getFolderNames(directory);
        await Promise.all(remainingFolders.map((folderName) => {
          return new Promise((resolve) => {
            rimraf(path.join(directory, folderName), resolve);
          })
        }));
        this.highlightedFolder = '..';
      }
    } catch (error) {
      console.log(error);
      // probably just aborted
    }

    this.promptMainMenu();
  }

  private async promptMoveFolder(currentDirectory: string, folderToMove: string): Promise<void> {
    this.currentPrompt = 'move-folder';
    this.currentFolderToMove = folderToMove;
    const folders = await this.getFolderNames(currentDirectory)
    const folderNameToMove = path.basename(folderToMove);
    this.currentMoveTarget = path.join(currentDirectory, folderNameToMove);

    const folderAlreadyExists = folders.some((folderName) => {
      return folderName === folderNameToMove;
    });

    const targetIsAcceptable = !folderAlreadyExists;

    const folderOptions = folders.map((folderName: string) => {
      const targetIsInsideSelf = path.join(currentDirectory, folderName).startsWith(folderToMove);
      let folderIsDisabled: string | boolean = false;
      if (targetIsInsideSelf) {
        folderIsDisabled = '(can\'t move a folder into itself)';
      }
      return {name: folderName, message: folderName, value: folderName, disabled: folderIsDisabled}
    });

    const options = [
      {name: '..', message: '..', value: '..'},
      ...folderOptions,
    ]

    const header = folderAlreadyExists
      ? `move: ${folderToMove}\n  to: '${folderNameToMove}' already exists here. choose a different location.`
      : `move: ${folderToMove}\n  to: ${path.join(currentDirectory, folderNameToMove)}`;

    const footer = targetIsAcceptable
      ? '[a]ccept, esc = abort'
      : 'esc = abort'

    this.moveFolderPrompt = new Select({
      name: 'targetFolder',
      message: null,
      choices: options,
      header: header,
      initial: this.highlightedFolder,
      footer: footer,
    });

    console.clear();
    try {
      const selectedFolder = await this.moveFolderPrompt.run();
      this.promptMoveFolder(path.join(currentDirectory, selectedFolder), folderToMove);
    } catch {
      this.moveFolderPrompt.stop();
      this.promptMainMenu();
    }
  }

  private async moveFolder(folderToMove: string, target: string) {
    await fsPromises.rename(folderToMove, target);
    this.promptMainMenu();
  }

  private async promptNonVideoPurge(folderToPurge: string): Promise<void> {
    this.currentPrompt = 'non-video-purge';
    const files = await this.getAllFilesInFolder(folderToPurge);
    const nonVideoFiles = files.filter((filename: string) => {
      const fileExtension = path.extname(filename);
      const fileIsVideo = videoFileExtensions.includes(fileExtension);
      return !fileIsVideo;
    });

    console.clear();
    this.confirmPurgePrompt = new Confirm({
      message: `deleting ${nonVideoFiles.length} non-video files. Are you sure?`,
      footer: 'esc = abort',
    });

    try {
      const userAgreed = await this.confirmPurgePrompt.run();
      if (userAgreed) {
        // delete all non-video-files
        await Promise.all(nonVideoFiles.map((fileName: string) => {
          return fsPromises.unlink(fileName);
        }));
      }
    } catch (error) {
      console.log(error);
      // probably just aborted
    }

    this.promptMainMenu();
  }

  private async promptSeriesRename(seriesDirectory: string): Promise<void> {
    this.currentSeriesDirectory = seriesDirectory;
    this.promptSeriesLanguage(seriesDirectory);
  }

  promptSeriesLanguage(seriesDirectory) {
    this.currentPrompt = 'series-language';
    this.currentSeriesLanguage = '';
    this.promptSeriesName(seriesDirectory, this.currentSeriesLanguage);
  }

  private async promptSeriesName(seriesDirectory: string, seriesLanguage: string) {
    this.currentPrompt = 'series-name';

    const seriesName = path.basename(seriesDirectory);

    const seriesNamePrompt = new Input({
      name: 'series name',
      message: `series name`,
      header: seriesDirectory,
      footer: 'esc = abort',
      initial: seriesName,
    });

    console.clear();
    try {
      this.currentSeriesName = await seriesNamePrompt.run();
      this.promptSeriesSuggestions(seriesDirectory, seriesLanguage, this.currentSeriesName);
    } catch (error) {
      // probably just aborted
      this.promptMainMenu();
    }
  }

  private promptSeriesSuggestions(seriesDirectory: string, seriesLanguage: string, seriesName: string) {
    this.currentPrompt = 'series-suggestions';
    this.currentSeries = {}
    this.promptEpisodeRenames(seriesDirectory, seriesLanguage, this.currentSeries);
  }

  private promptEpisodeRenames(seriesName: string, seriesLanguage: string, selectedSeries: any) {
    this.currentPrompt = 'episode-renames';
    if (this.currentEpisodeRenames.length === 0) {
      // TODO: fetch episode renames
    }
    this.currentEpisodeRenames = []
  }

  private promptEpisodeAssign(filePath: string, series: any) {
    this.currentPrompt = 'assign-episode';
  }

  private async getAllFilesInFolder(folderPath: string): Promise<Array<string>> {
    const currentFolderItems = await fsPromises.readdir(folderPath);
    const [files, folders] = await Promise.all([
      this.filterAsync(currentFolderItems, async (itemName: string): Promise<boolean> => {
        const isFolder = await this.isFolder(path.join(folderPath, itemName));
        return !isFolder
      }),
      this.filterAsync(currentFolderItems, async (itemName: string): Promise<boolean> => {
        const isFolder = await this.isFolder(path.join(folderPath, itemName));
        return isFolder
      }),
    ]);

    const filesInThisFolder = files.map((fileName: string) => {
      return path.join(folderPath, fileName);
    })

    const filesInSubFolders = await Promise.all(folders.map((folderName: string) => {
      return this.getAllFilesInFolder(path.join(folderPath, folderName));
    }));

    return [
      ...filesInThisFolder,
      ...filesInSubFolders.flat(),
    ]
  }

  private async getFolderNames(basePath: string): Promise<Array<string>> {
    const currentFolderItems = await fsPromises.readdir(basePath);
    return this.filterAsync(currentFolderItems, async (itemName: string): Promise<boolean> => {
      const isFolder = await this.isFolder(path.join(basePath, itemName));
      return isFolder
    });
  }

  private async getFileNames(basePath: string): Promise<Array<string>> {
    const currentFolderItems = await fsPromises.readdir(basePath);
    return this.filterAsync(currentFolderItems, async (itemName: string): Promise<boolean> => {
      const isFolder = await this.isFolder(path.join(basePath, itemName));
      return !isFolder
    });
  }

  private async isFolder(folderPath: string): Promise<boolean> {
    let folderStats;
    try {
      folderStats = await fsPromises.stat(folderPath);
    } catch {
      return false;
    }

    return folderStats.isDirectory();
  }

  private async filterAsync<TArrayElement>(
    arrayToFilter: Array<TArrayElement>,
    filterMethod: (element: TArrayElement, index: number, originalArray: Array<TArrayElement>) => Promise<boolean>,
  ): Promise<Array<TArrayElement>> {
    const filterResults: Array<boolean> = await Promise.all(arrayToFilter.map(filterMethod));

    return arrayToFilter.filter((element: TArrayElement, index: number): boolean => {
      const elementCanStayInArray: boolean = filterResults[index];

      return elementCanStayInArray;
    });
  }

  private handleKeyPress = (key: string, data: KeyPressData) : void=> {
    if (this.currentPrompt === 'folder-selection') {
      this.handleFolderSelectionKeyPress(key, data);
    }

    if (this.currentPrompt === 'move-folder') {
      this.handleMoveFolderKeyPress(key, data);
    }

    if (this.currentPrompt === 'hoist-files') {
      this.handleHoistFilesKeyPress(key, data);
    }

    if (this.currentPrompt === 'non-video-purge') {
      this.handleNonVideoPurgeKeyPress(key, data);
    }

    if (this.currentPrompt === 'series-language') {
      this.handleSeriesLanguageKeyPress(key, data);
    }

    if (this.currentPrompt === 'series-suggestions') {
      this.handleSeriesSuggestionsKeyPress(key, data);
    }

    if (this.currentPrompt === 'episode-renames') {
      this.handleEpisodeRenamesKeyPress(key, data);
    }

    if (this.currentPrompt === 'assign-episode') {
      this.handleAssignEpisodeKeyPress(key, data);
    }
  }

  private handleFolderSelectionKeyPress(key: string, data: KeyPressData): void {
    this.highlightedFolder = this.filesPrompt.selected.value;
    const selectedFolder = path.join(this.currentDirectory, this.filesPrompt.selected.value);
    if (key === 'r') {
      this.filesPrompt.stop();
      this.promptRename(selectedFolder);
    }
    if (key === 'c') {
      this.filesPrompt.stop();
      this.promptCreateFolder(this.currentDirectory);
    }
    if (key === 'd') {
      this.filesPrompt.stop();
      this.promptDeleteFolder(selectedFolder);
    }
    if (key === 'h') {
      this.filesPrompt.stop();
      this.hoistFiles(this.currentDirectory);
    }
    if (key === 'm') {
      this.filesPrompt.stop();
      this.promptMoveFolder(this.currentDirectory, selectedFolder);
    }
    if (key === 'u') {
      this.filesPrompt.stop();
      this.promptMainMenu();
    }
    if (key === 'p') {
      this.filesPrompt.stop();
      this.promptNonVideoPurge(this.currentDirectory);
    }
    if (key === 'e') {
      this.filesPrompt.stop();
    }
    if (key === 's') {
      this.filesPrompt.stop();
      this.promptSeriesRename(this.currentDirectory);
    }
  }

  private handleMoveFolderKeyPress(key: string, data: KeyPressData): void {
    if (key === 'a') {
      this.moveFolder(this.currentFolderToMove, this.currentMoveTarget);
    }
    if (data.name === 'backspace') {
      this.moveFolderPrompt.stop();
      this.promptMainMenu();
    }
  }

  private handleHoistFilesKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      this.confirmHoistPrompt.stop();
      this.promptMainMenu();
    }
  }

  private handleNonVideoPurgeKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      this.confirmPurgePrompt.stop();
      this.promptMainMenu();
    }
  }

  private handleSeriesLanguageKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      // TODO: Stop language selection
      this.promptMainMenu();
    }
  }

  private handleSeriesSuggestionsKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      // TODO: Stop suggestion selection
      this.promptSeriesName(this.currentSeriesDirectory, this.currentSeriesLanguage);
    }
  }

  private handleEpisodeRenamesKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      // TODO: Stop episode rename prompt
      this.promptSeriesSuggestions(this.currentSeriesDirectory, this.currentSeriesLanguage, this.currentSeriesName);
    }
  }

  private handleAssignEpisodeKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      // TODO: Stop assign episode prompt
      this.promptEpisodeRenames(this.currentSeriesDirectory, this.currentSeriesLanguage, this.currentSeriesName);
    }
  }
}
