import {promises as fsPromises} from 'fs';
import {Select, Input, Confirm} from 'enquirer/lib/prompts';
import path from 'path';

type KeyPressData = {
  sequence: string,
  name: string,
  ctrl: boolean,
  meta: boolean,
  shift: boolean,
};

export class FileBrowser {

  private startDirectory: string;
  private currentDirectory: string;
  private highlightedFolder: string;
  private currentPrompt: 'folder-selection' | 'rename' | 'create-folder' | 'delete-folder' | 'series-name' | 'series-selection';
  private filesPrompt: Select;
  constructor(startDirectory: string = process.cwd()) {
    this.startDirectory = startDirectory;
    this.currentDirectory = this.startDirectory;
  }

  public async start(): Promise<void> {
    console.log(this.startDirectory)
    console.log(this.currentDirectory)
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
      footer: '[r]ename, [c]reate folder, [d]elete',
    });

    console.clear();
    const selectedFolder = await this.filesPrompt.run();
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

    const confirmPrompt = new Confirm({
      name: `delete ${filePath}`,
      message: 'are you sure?',
      footer: 'esc = abort',
    });

    console.clear();
    try {
      const userAgreed = await confirmPrompt.run();
      if (userAgreed) {
        await fsPromises.rmdir(filePath);
        this.highlightedFolder = undefined;
      }
    } catch (error) {
      // probably just aborted
    }

    this.promptMainMenu();
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
    if (this.currentPrompt === 'rename') {
      this.handleRenameKeyPress(key, data);
    }

    if (this.currentPrompt === 'series-name') {
      this.handleSeriesNameKeyPress(key, data);
    }

    if (this.currentPrompt === 'series-selection') {
      this.handleSeriesSelectionKeyPress(key, data);
    }
  }

  private handleFolderSelectionKeyPress(key: string, data: KeyPressData): void {
    if (key === 'r') {
      this.highlightedFolder = this.filesPrompt.selected.value;
      const selectedFolder = path.join(this.currentDirectory, this.filesPrompt.selected.value);
      this.filesPrompt.stop();
      this.promptRename(selectedFolder);
    }
    if (key === 'c') {
      this.highlightedFolder = this.filesPrompt.selected.value;
      this.filesPrompt.stop();
      this.promptCreateFolder(this.currentDirectory);
    }
    if (key === 'd') {
      this.highlightedFolder = this.filesPrompt.selected.value;
      this.filesPrompt.stop();
      const selectedFolder = path.join(this.currentDirectory, this.filesPrompt.selected.value);
      this.promptDeleteFolder(selectedFolder);
    }
  }

  private handleRenameKeyPress(key: string, data: KeyPressData): void {

  }

  private handleSeriesNameKeyPress(key: string, data: KeyPressData): void {

  }

  private handleSeriesSelectionKeyPress(key: string, data: KeyPressData): void {

  }
}
