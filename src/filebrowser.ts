import {promises as fsPromises, rename} from 'fs';
import {Select, Input, Confirm} from 'enquirer/lib/prompts';
import path from 'path';
import rimraf from 'rimraf';
import TVDB from 'node-tvdb';

type KeyPressData = {
  sequence: string,
  name: string,
  ctrl: boolean,
  meta: boolean,
  shift: boolean,
};

type SeriesLanguage = {
  id: number,
  abbreviation: string,
  name: string,
  englishName: string,
}

type Episode = {
  id: number,
  airedSeason: number,
  airedSeasonID: number,
  airedEpisodeNumber: number,
  episodeName: string,
  firstAired: string,
  overview: string,
  productionCode: string,
  showUrl: string,
  lastUpdated: number,
  dvdDiscid: string,
  dvdSeason: number,
  dvdEpisodeNumber: number
  dvdChapter: number,
  absoluteNumber: number,
  filename: string,
  seriesId: number,
  lastUpdatedBy: number,
  thumbAuthor: number,
  thumbAdded: string,
  thumbWidth: string,
  thumbHeight: string,
  imdbId: string,
  siteRating: number,
  siteRatingCount: number
}

type Series = {
  aliases: Array<string>,
  banner: string,
  firsAired: string,
  id: number,
  network: string,
  overview: string,
  seriesName: string,
  slug: string,
  status: string,
  episodes: Array<Episode>
}

type ArrayPromptOption = {
  name: string,
  message: string,
  value: any,
  disabled?: boolean,
}

type FolderSeasonMatch = {
  folderName: string,
  season: number,
}

interface EpisodeMapping extends ArrayPromptOption {
  value: {
    originalPath: string,
    updatedPath: string,
    rename: boolean,
    episode: Episode,
    episodeNumber: string,
    seasonNumber: number,
    seasonFolder: string,
  }
}

interface SeasonMapping {
  [season: number]: {
    folderName?: string,
    episodeMappings: Array<EpisodeMapping>
  }
}

const tvdb = new TVDB(process.env.TVDB_API_KEY);

const videoFileExtensions = ['.mp4', '.mkv', '.avi'];
const episodeRegexes = [
  {regex: /[eE]\d+/, numberStart: 1},
  {regex: /[xX]\d+/, numberStart: 1},
  {regex: /\d+/, numberStart: 0}
];
const episodeReplaces = [
  {regex: /ä/g, replacement: 'ae'},
  {regex: /ö/g, replacement: 'oe'},
  {regex: /ü/g, replacement: 'ue'},
  {regex: /ß/g, replacement: 'ss'},
  {regex: /Ä/g, replacement: 'AE'},
  {regex: /Ö/g, replacement: 'OE'},
  {regex: /Ü/g, replacement: 'UE'},
  {regex: /\?/g, replacement: ''},
  {regex: /,/g, replacement: ''},
  {regex: /: /g, replacement: '-'},
  {regex: /:/g, replacement: '-'},
  {regex: /"/g, replacement: '\''},
  {regex: / /g, replacement: '.'},
  {regex: /\//g, replacement: '_'},
  {regex: /\t/g, replacement: ''},
]

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
  private seriesLanguagePrompt: Select;
  private seriesNamePrompt: Input;
  private seriesSelectionPrompt: Select;
  private episodeRenamePrompt: Select;
  private episodeAssignPrompt: Select;

  private currentFolderToMove: string;
  private currentMoveTarget: string;

  private currentSeriesDirectory: string;
  private currentSeriesLanguage: SeriesLanguage;
  private currentSeriesName: string;
  private currentSeries: Series;
  private currentEpisodeRenames: SeasonMapping;
  private currentEpisodeAssign: EpisodeMapping;

  constructor(startDirectory: string = process.cwd()) {
    this.startDirectory = startDirectory;
    this.currentDirectory = this.startDirectory;
  }

  public async start(): Promise<void> {
    process.stdin.on('keypress', this.handleKeyPress);
    console.clear();
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
      message: null,
      choices: options,
      header: this.currentDirectory,
      initial: this.highlightedFolder,
      footer: '[R]ename, [C]reate folder, [D]elete, [M]ove, [U]pdate, [H]oist files, [P]urge non-videos, [S]tandardize names, [E]xit',
    });

    const selectedFolder = await this.filesPrompt.run();
    this.filesPrompt.stop();
    if (selectedFolder === '..') {
      this.highlightedFolder = path.basename(this.currentDirectory);
    } else {
      this.highlightedFolder = '..';
    }
    this.currentDirectory = path.join(this.currentDirectory, selectedFolder);
    console.clear();
    this.promptMainMenu();
  }

  private async promptRename(filePath: string) {
    this.currentPrompt = 'rename';

    const directory = path.dirname(filePath);
    const filename = path.basename(filePath);

    const renamePrompt = new Input({
      message: `rename ${filename}`,
      header: directory,
      footer: 'esc = abort',
      initial: filename,
    });

    console.clear();
    try {
      const newName = await renamePrompt.run();
      renamePrompt.stop();
      const oldPath = path.join(directory, filename);
      const newPath = path.join(directory, newName);
      await fsPromises.rename(oldPath, newPath);
      this.highlightedFolder = newName;
    } catch (error) {
      renamePrompt.stop();
      // probably just aborted
    }

    console.clear();
    this.promptMainMenu();
  }

  private async promptCreateFolder(targetDirectory: string) {
    this.currentPrompt = 'create-folder';

    const createFolderPrompt = new Input({
      message: 'name',
      header: targetDirectory,
      footer: 'esc = abort',
    });

    console.clear();
    try {
      const folderName = await createFolderPrompt.run();
      createFolderPrompt.stop();
      await fsPromises.mkdir(path.join(targetDirectory, folderName));
      this.highlightedFolder = folderName;
    } catch (error) {
      createFolderPrompt.stop();
      // probably just aborted
    }

    console.clear();
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
      this.confirmDeletePrompt.stop();
      if (userAgreed) {
        await new Promise((resolve) => {
          rimraf(filePath, resolve);
        })
        this.highlightedFolder = '..';
      }
    } catch (error) {
      this.confirmDeletePrompt.stop();
      // probably just aborted
    }

    console.clear();
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
      this.confirmHoistPrompt.stop();
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
      this.confirmHoistPrompt.stop();
      // probably just aborted
    }

    console.clear();
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
      message: null,
      choices: options,
      header: header,
      initial: this.highlightedFolder,
      footer: footer,
    });

    console.clear();
    try {
      const selectedFolder = await this.moveFolderPrompt.run();
      this.moveFolderPrompt.stop();
      this.promptMoveFolder(path.join(currentDirectory, selectedFolder), folderToMove);
    } catch {
      this.moveFolderPrompt.stop();
      console.clear();
      this.promptMainMenu();
    }
  }

  private async moveFolder(folderToMove: string, target: string) {
    await fsPromises.rename(folderToMove, target);
    console.clear();
    this.promptMainMenu();
  }

  private async promptNonVideoPurge(folderToPurge: string): Promise<void> {
    this.currentPrompt = 'non-video-purge';
    const files = await this.getAllFilesInFolder(folderToPurge);
    const nonVideoFiles = files.filter((filename: string) => {
      const fileExtension = path.extname(filename).toLowerCase();
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
      this.confirmPurgePrompt.stop();
      if (userAgreed) {
        // delete all non-video-files
        await Promise.all(nonVideoFiles.map((fileName: string) => {
          return fsPromises.unlink(fileName);
        }));
      }
    } catch (error) {
      this.confirmPurgePrompt.stop();
      // probably just aborted
    }

    console.clear();
    this.promptMainMenu();
  }

  private async promptSeriesRename(seriesDirectory: string): Promise<void> {
    this.currentSeriesDirectory = seriesDirectory;
    console.clear();
    this.promptSeriesLanguage(seriesDirectory);
  }

  private async promptSeriesLanguage(seriesDirectory) {
    this.currentPrompt = 'series-language';
    this.currentEpisodeRenames = undefined;
    const languages: Array<SeriesLanguage> = await tvdb.getLanguages();
    
    const options = languages.map((language: any) => {
      return {
        name: language.abbreviation,
        message: language.englishName,
        value: language,
      };
    });
    this.seriesLanguagePrompt = new Select({
      message: null,
      choices: options,
      header: `Folder: ${seriesDirectory}`,
      initial: 'de',
      footer: 'esc = abort',
    });
  
    try {
      await this.seriesLanguagePrompt.run();
      this.currentSeriesLanguage = this.seriesLanguagePrompt.selected.value;
      this.seriesLanguagePrompt.stop();
      console.clear();
      this.promptSeriesName(seriesDirectory, this.currentSeriesLanguage);
    } catch {
      this.seriesLanguagePrompt.stop();
      console.clear();
      this.promptMainMenu();
    }
  }

  private async promptSeriesName(seriesDirectory: string, seriesLanguage: SeriesLanguage) {
    this.currentPrompt = 'series-name';

    const seriesName = path.basename(seriesDirectory);

    this.seriesNamePrompt = new Input({
      message: `series name`,
      header: `Folder: ${seriesDirectory}\nLanguage: ${seriesLanguage.englishName}`,
      footer: 'esc = abort',
      initial: seriesName,
    });

    try {
      this.currentSeriesName = await this.seriesNamePrompt.run();
      this.seriesNamePrompt.stop();
      console.clear();
      this.promptSeriesSuggestions(seriesDirectory, seriesLanguage, this.currentSeriesName);
    } catch (error) {
      // probably just aborted
      this.seriesNamePrompt.stop();
      console.clear();
      this.promptSeriesLanguage(seriesDirectory);
    }
  }

  private async promptSeriesSuggestions(seriesDirectory: string, seriesLanguage: SeriesLanguage, seriesName: string) {
    this.currentPrompt = 'series-suggestions';
    this.currentEpisodeRenames = undefined;
    let possibleSeries: Array<Series>;
    try {
      possibleSeries = await tvdb.getSeriesByName(seriesName, {lang: seriesLanguage.abbreviation})
    } catch {
      console.clear();
      console.log('Series not found. Did you spell it correctly?');
      this.promptSeriesName(seriesDirectory, seriesLanguage);
      return;
    }

    const options = possibleSeries.map((series: Series) => {
      return {
        name: series.id,
        message: series.seriesName,
        value: series,
      };
    });
    this.seriesSelectionPrompt = new Select({
      message: null,
      choices: options,
      header: `Folder: ${seriesDirectory}\nLanguage: ${seriesLanguage.englishName}\nSearchTerm: ${seriesName}`,
      footer: 'esc = abort',
    });
  
    try {
      await this.seriesSelectionPrompt.run();
      this.currentSeries = this.seriesSelectionPrompt.selected.value;
      this.seriesSelectionPrompt.stop();
      console.clear();
      this.promptEpisodeRenames(seriesDirectory, seriesLanguage, this.currentSeries);
    } catch {
      this.seriesSelectionPrompt.stop();
      console.clear();
      this.promptSeriesName(seriesDirectory, seriesLanguage);
    }
  }

  private async promptEpisodeRenames(seriesDirectory: string, seriesLanguage: SeriesLanguage, selectedSeries: Series) {
    this.currentPrompt = 'episode-renames';
    const seriesDetails = await tvdb.getSeriesAllById(selectedSeries.id, {lang: seriesLanguage.abbreviation});
    if (this.currentEpisodeRenames === undefined) {
      this.currentEpisodeRenames = await this.generateEpisodeNames(seriesDirectory, seriesDetails);
    }

    const seasons = Object.keys(this.currentEpisodeRenames).sort();
    const options = [];
    for (const season of seasons) {
      options.push({
        name: `season${season}`,
        message: `--- Season ${season} (${this.currentEpisodeRenames[season].folderName}) ---`,
        value: `season${season}`,
        disabled: '',
      }, ...this.currentEpisodeRenames[season].episodeMappings)
    }
    this.episodeRenamePrompt = new Select({
      message: null,
      choices: options,
      header: `Folder: ${seriesDirectory}\nLanguage: ${seriesLanguage.englishName}\nSeries: ${selectedSeries.seriesName}`,
      footer: '[a]ccept, esc = abort',
      initial: this.currentEpisodeAssign ? this.currentEpisodeAssign.name : undefined,
    });
  
    try {
      await this.episodeRenamePrompt.run();
      this.currentEpisodeAssign = this.episodeRenamePrompt.selected;
      this.episodeRenamePrompt.stop();
      console.clear();
      this.promptEpisodeAssign(seriesDirectory, seriesLanguage, seriesDetails, this.currentEpisodeAssign);
    } catch {
      this.episodeRenamePrompt.stop();
      console.clear();
      this.promptSeriesName(seriesDirectory, seriesLanguage);
    }
  }

  private async promptEpisodeAssign(seriesDirectory: string, seriesLanguage: SeriesLanguage, selectedSeries: Series, episodeMapping: EpisodeMapping) {
    this.currentPrompt = 'assign-episode';
    const possibleEpisodes = this.generateEpisodeSelection(selectedSeries, episodeMapping.value.seasonNumber);

    const seasons = Object.keys(possibleEpisodes).sort();
    const options = [];
    for (const season of seasons) {
      options.push({
        name: `season${season}`,
        message: `--- Season ${season} ---`,
        value: `season${season}`,
        disabled: '',
      }, ...possibleEpisodes[season].episodeMappings)
    }
    this.episodeAssignPrompt = new Select({
      message: null,
      choices: options,
      header: `File: ${episodeMapping.value.originalPath}\nLanguage: ${seriesLanguage.englishName}\nSeries: ${selectedSeries.seriesName}`,
      footer: 'esc = abort',
    });
  
    try {
      await this.episodeAssignPrompt.run();
      const selectedEpisode: Episode = this.episodeAssignPrompt.selected.value;
      const episodesInSeason = selectedSeries.episodes.filter((seriesEpisode: Episode) => {
        return seriesEpisode.airedSeason === selectedEpisode.airedSeason;
      });
      const seasonMappings = this.currentEpisodeRenames[episodeMapping.value.seasonNumber];
      for (let i = 0; i < seasonMappings.episodeMappings.length; i++) {
        if (seasonMappings.episodeMappings[i].name === episodeMapping.name) {
          seasonMappings.episodeMappings[i] = this.generateEpisodeName(
            selectedSeries.seriesName,
            episodeMapping.value.seasonFolder,
            episodeMapping.value.seasonNumber,
            path.basename(episodeMapping.value.originalPath),
            episodesInSeason,
            selectedEpisode.airedEpisodeNumber,
          )
          console.log(seasonMappings.episodeMappings[i]);
        }
      }

      this.currentEpisodeRenames[episodeMapping.value.seasonNumber].episodeMappings.sort(this.sortEpisodeMappings);
      this.episodeAssignPrompt.stop();
      console.clear();
      this.promptEpisodeRenames(seriesDirectory, seriesLanguage, selectedSeries);
    } catch {
      this.episodeAssignPrompt.stop();
      console.clear();
      this.promptSeriesName(seriesDirectory, seriesLanguage);
    }
  }

  private async renameEpisodes(episodeRenames: SeasonMapping) {
    let renamedFileCount = 0;
    const seasonMappings = Object.values(episodeRenames).map((season: {folderName?: string, episodeMappings: Array<EpisodeMapping>}): Promise<Array<void>> => {
      const episodeMappings = season.episodeMappings.map(async(episodeMapping: EpisodeMapping): Promise<void> =>{
        if (episodeMapping.value.rename !== false) {
          renamedFileCount++;
          return fsPromises.rename(episodeMapping.value.originalPath, episodeMapping.value.updatedPath);
        }
      });
      return Promise.all(episodeMappings);
    });

    await Promise.all(seasonMappings);
    console.log(`renamed ${renamedFileCount} files`);
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
      console.clear();
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
      console.clear();
      this.promptMainMenu();
    }
  }

  private handleHoistFilesKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      this.confirmHoistPrompt.stop();
      console.clear();
      this.promptMainMenu();
    }
  }

  private handleNonVideoPurgeKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      this.confirmPurgePrompt.stop();
      console.clear();
      this.promptMainMenu();
    }
  }

  private handleSeriesLanguageKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      this.seriesLanguagePrompt.stop();
      console.clear();
      this.promptMainMenu();
    }
  }

  private handleSeriesSuggestionsKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      this.seriesSelectionPrompt.stop();
      console.clear();
      this.promptSeriesName(this.currentSeriesDirectory, this.currentSeriesLanguage);
    }
  }

  private handleEpisodeRenamesKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      this.episodeRenamePrompt.stop();
      console.clear();
      this.promptSeriesSuggestions(this.currentSeriesDirectory, this.currentSeriesLanguage, this.currentSeriesName);
    }
    if (key === 'a') {
      this.episodeRenamePrompt.stop();
      console.clear();
      this.renameEpisodes(this.currentEpisodeRenames);
      this.promptMainMenu();
    }
  }

  private handleAssignEpisodeKeyPress(key: string, data: KeyPressData): void {
    if (data.name === 'backspace') {
      this.episodeAssignPrompt.stop();
      console.clear();
      this.promptEpisodeRenames(this.currentSeriesDirectory, this.currentSeriesLanguage, this.currentSeries);
    }
  }

  private generateEpisodeSelection(seriesDetails: Series, targetSeason?: number): SeasonMapping {
    const result = {};
    for (const episode of seriesDetails.episodes) {
      const season = episode.airedSeason;
      if (targetSeason !== undefined && season !== targetSeason) {
        continue;
      }
      if (result[season] === undefined) {
        result[season] = {episodeMappings: []}
      }

      result[season].episodeMappings.push(this.generateEpisodeMapping(seriesDetails, episode));
    }
  
    return result;
  }

  private generateEpisodeMapping(seriesDetails: Series, episode: Episode): ArrayPromptOption {
    const episodesInSeason = seriesDetails.episodes.filter((seriesEpisode: Episode) => {
      return seriesEpisode.airedSeason === episode.airedSeason;
    });

    const prefixedEpisodeNumber = this.generateEpisodeNumber(episode.airedEpisodeNumber, episodesInSeason.length);
    return {
      name: `${episode.id}`,
      message: `E${prefixedEpisodeNumber}: ${episode.episodeName}`,
      value: episode,
    }
  } 

  private async generateEpisodeNames(seriesDirectory: string, seriesDetails: Series): Promise<SeasonMapping> {
    const folders = await this.getFolderNames(seriesDirectory);
    
    const seasonRegex = /\d+/;
    const seasonFolders = folders.map((folderName: string): FolderSeasonMatch => {
      const folderSeasonNumber = folderName.match(seasonRegex);
      if (folderSeasonNumber === null) {
        return undefined;
      }
      return {
        folderName: folderName,
        season: parseInt(folderSeasonNumber[0]),
      }
    }).filter((folderSeasonInfo: FolderSeasonMatch): boolean => {
      return folderSeasonInfo !== undefined;
    });

    const episodeMappings = await Promise.all(seasonFolders.map((folderSeasonInfo: FolderSeasonMatch): Promise<Array<ArrayPromptOption>> => {
      const seasonFolder = path.join(seriesDirectory, folderSeasonInfo.folderName)
      return this.generateEpisodeNamesForSeason(seasonFolder, folderSeasonInfo.season, seriesDetails);
    }));

    const result: SeasonMapping = {};
    for (let i = 0; i < seasonFolders.length; i++) {
      result[seasonFolders[i].season] = {
        folderName: seasonFolders[i].folderName,
        episodeMappings: episodeMappings[i],
      }
    }

    return result;
  }

  private async generateEpisodeNamesForSeason(seasonFolder: string, season: number, seriesDetails: Series): Promise<Array<EpisodeMapping>> {
    const episodesInSeason = seriesDetails.episodes.filter((episode: Episode) => {
      return episode.airedSeason === season;
    });

    const filesInSeasonFolder = await this.getFileNames(seasonFolder);
    return filesInSeasonFolder.map((fileName) => {
      return this.generateEpisodeName(seriesDetails.seriesName, seasonFolder, season, fileName, episodesInSeason);
    })
    .filter((episodeMapping: EpisodeMapping) => {
      return episodeMapping !== undefined;
    })
    .sort(this.sortEpisodeMappings)
  }

  private sortEpisodeMappings(episodeMapping1: EpisodeMapping, episodeMapping2: EpisodeMapping): number {
    const episode1 = episodeMapping1.value.episode !== undefined
      ? episodeMapping1.value.episode.airedEpisodeNumber
      : undefined;

    const episode2 = episodeMapping2.value.episode !== undefined
      ? episodeMapping2.value.episode.airedEpisodeNumber
      : undefined;
      
    if (episode1 === episode2) {
      return 0;
    }
    
    if (episode1 === undefined) {
      return 1
    }

    if (episode2 === undefined) {
      return -1;
    }

    return episode1 - episode2;
  }

  private generateEpisodeName(
    seriesName: string,
    seasonFolder: string,
    seasonNumber: number,
    fileName: string,
    episodesInSeason: Array<Episode>,
    forceEpisodeNumber?: number,
  ): EpisodeMapping {
    const fileExtension = path.extname(fileName).toLowerCase();
    const fileIsVideo = videoFileExtensions.includes(fileExtension);
    if (!fileIsVideo) {
      return this.unchangedEpisodeMapping(seasonFolder, seasonNumber, fileName);
    }

    let episodeNumber = forceEpisodeNumber;
    if (episodeNumber === undefined) {
      for (const {regex, numberStart} of episodeRegexes) {
        const episodeNumberMatch = fileName.match(regex);
        if (episodeNumberMatch !== null) {
          episodeNumber = parseInt(episodeNumberMatch[0].substring(numberStart))
          break;
        }
      }
    }
  
    if (episodeNumber === undefined) {
      return this.unchangedEpisodeMapping(seasonFolder, seasonNumber, fileName);
    }

    const episode = episodesInSeason.find((episode: Episode) => {
      return episode.airedEpisodeNumber === episodeNumber;
    });

    if (episode === undefined) {
      return this.unchangedEpisodeMapping(seasonFolder, seasonNumber, fileName);
    }

    const prefixedEpisodeNumber = this.generateEpisodeNumber(episodeNumber, episodesInSeason.length);
    const sanatizedName = this.generateEpisodeFileName(
      fileExtension,
      seriesName,
      episode.airedSeason,
      episode.episodeName,
      episode.airedEpisodeNumber,
      episodesInSeason.length
    );
    return {
      name: sanatizedName,
      message: `E${prefixedEpisodeNumber}: ${fileName} > ${sanatizedName}`,
      value: {
        originalPath: path.join(seasonFolder, fileName),
        updatedPath: path.join(seasonFolder, sanatizedName),
        episode: episode,
        rename: fileName !== sanatizedName,
        episodeNumber: prefixedEpisodeNumber,
        seasonNumber: seasonNumber,
        seasonFolder: seasonFolder,
      }
    }
  }

  private generateEpisodeNumber(episodeNumber: number, episodesInSeason: number) {
    if (episodesInSeason < 100) {
      return this.twoZero(episodeNumber);
    }
    return this.threeZero(episodeNumber);
  }

  private unchangedEpisodeMapping(seasonFolder: string, seasonNumber: number, fileName: string): EpisodeMapping {
    return {
      name: fileName,
      message: `--- ${fileName}`,
      value: {
        originalPath: path.join(seasonFolder, fileName),
        updatedPath: path.join(seasonFolder, fileName),
        episode: undefined,
        rename: false,
        episodeNumber: undefined,
        seasonNumber: seasonNumber,
        seasonFolder: seasonFolder,
      }
    }
  }

  private generateEpisodeFileName(
    fileExtension: string,
    seriesName: string,
    seasonNumber: number,
    episodeName: string,
    episodeNumber: number,
    episodesInSeason: number
  ): string {
    let newEpisodeName = `${seriesName}.S${this.twoZero(seasonNumber)}E${this.generateEpisodeNumber(episodeNumber, episodesInSeason)}.${episodeName}${fileExtension}`;
    for (const {regex, replacement} of episodeReplaces) {
      newEpisodeName = newEpisodeName.replace(regex, replacement);
    }
    return newEpisodeName;
  }

  private twoZero(input: number): string {
    if (input < 10) {
      return `0${input}`;
    }

    return `${input}`;
  }

  private threeZero(input: number): string {
    if (input < 100) {
      return `0${this.twoZero(input)}`;
    }

    return `${input}`;
  }
}
