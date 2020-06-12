const _ = require('underscore');
const serverUtil = require("../serverUtil");
const db = require("./db");
const { getAllFilePathes, getFileToInfo } = db;
const util = global.requireUtil();
const path = require("path");
const zipInfoDb = require("./zipInfoDb");
const { getZipInfo }  = zipInfoDb;
const pathUtil = require("../pathUtil");
const { isExist,  isDirectParent, isSub } = pathUtil;
const nameParser = require('../../name-parser');
const { useless_tag_regex, getCurrentTime } =  util;

const userConfig = global.requireUserConfig();
const {good_folder_root} = userConfig;

const forest = require("ml-random-forest");
const RFClassifier = forest.RandomForestClassifier;

//random forest training is so slow
// #data	 time in ms
// 1000	  2000
// 1500	  5331
// 2500	  12999
// 3000	  18535
// 4000	  35000


const not_good_pattern = "D:\\_Happy_Lesson\\_Going_to_sort\\_Compressed";

function toKey(str){
    return str.toLowerCase().replace(/-| |\!/, "");
    //or the search will be wrong
  }

function addToArray(table, key, value){
    if(!key || !value){
        return;
    }
    if (!table[key]) {
        table[key] = [value];
    } else {
        table[key].push(value);
    }
}

function getFeature(filePath){
    const zipInfo = getZipInfo([filePath])[filePath];
    const fileInfo = getFileToInfo(filePath);
    const fileTimeA = (fileInfo && fileInfo.mtimeMs) || 0;
    
    let year = new Date(fileTimeA).getFullYear();
    let pageNumber = (zipInfo && zipInfo.pageNum) || 20;

    //naive scaling
    // year = (year - 1970)/100;
    // pageNumber = Math.log10(pageNumber)/3;

    const fileName = path.basename(filePath);
    const result = nameParser.parse(fileName);


    let authorNum = 0;
    let tagNum = 0;

    if(result){
        (result && result.authors||[]).forEach(author => {
            //some author is actually group, fake author
            author = toKey(author);
            let subfiles = authorToFiles[author] || [];
            subfiles = subfiles.filter(e => isSub(good_folder_root, e));
            authorNum = subfiles.length;
        })
    
        result.tags.forEach(tag => {
            if(tag.match(useless_tag_regex)){
              return;
            }
            tag = toKey(tag);
            let subfiles = tagToFiles[tag] || [];
            subfiles = subfiles.filter(e => isSub(good_folder_root, e));
            tagNum = subfiles.length;
        });
    }

    // authorNum /= 100;
    // tagNum = tagNum/100;

    return [pageNumber, year, authorNum, tagNum];
}

const authorToFiles = {};
const tagToFiles = {};

function init(){
    const filePathes = getAllFilePathes().filter(util.isCompress)
    .filter(e => {
        return isSub(good_folder_root, e) || e.startsWith(not_good_pattern);
    });

    const groupSet = {};

    filePathes.forEach(filePath =>{
        const fileName = path.basename(filePath);
        const result = nameParser.parse(fileName);
        if (result && result.group) {
          const group = toKey(result.group);
          groupSet[group] = true;
        }
    })
    
    filePathes.forEach(filePath =>{
        const fileName = path.basename(filePath);
        const result = nameParser.parse(fileName);
        if (result) {
            (result.authors||[]).forEach(author => {
              //some author is actually group, fake author
              author = toKey(author);
              if(!groupSet[author]){
                addToArray(authorToFiles, author, filePath );
              }
            })

            result.tags.forEach(tag => {
              if(tag.match(useless_tag_regex)){
                return;
              }
              tag = toKey(tag);
              addToArray(tagToFiles, tag, filePath);
            });
        }
    });

    var inputSet = new Array();
    var outputSet = new Array();

    //going to generate training date
    const sets = _.shuffle(filePathes);
    sets.forEach(filePath =>{
        const feature = getFeature(filePath);
        // console.log(feature);

        const isGood = isSub(good_folder_root, filePath);
        const y = isGood? 1: 0;

        inputSet.push(feature);
        outputSet.push(y);
    });

    console.log("-----machine learning----")
    const beginTime = getCurrentTime();

    const totalLength = inputSet.length;
    const valid_length = 200;
    const sep = totalLength - valid_length;
    const trainingSet = inputSet.slice(0, sep);
    const trainingOutput = outputSet.slice(0, sep);

    const by = require('ml-naivebayes');
    var classifier = new by.GaussianNB();
    classifier.train(trainingSet, trainingOutput);


    const timeSpent = getCurrentTime() - beginTime;
    console.log(`${timeSpent}ms to train for ${trainingSet.length} data`);

    const GOOD_STANDARD = 1;
    let naivecount = 0;
    let count = 0;

    const validInput = inputSet.slice(sep);
    const validOutput = outputSet.slice(sep);
    for(let ii = 0; ii < validInput.length; ii++){
        const x = validInput[ii];
        const expected = validOutput[ii];

        let result = classifier.predict([x]);
        if(result[0] === expected ){
            count++;
        }

        const fp = sets[ii];
        const fn = path.basename(fp);
        result = nameParser.parse(fn);
        let guess = false;
        if (result) {
            (result.authors||[]).forEach(author => {
              //some author is actually group, fake author
              author = toKey(author);
              if(!groupSet[author]){
                  let subfiles = authorToFiles[author] || [];
                  subfiles = subfiles.filter(e => isSub(good_folder_root, e))
                  guess = subfiles.length > GOOD_STANDARD? 1: 0;
              }
            })
        }

        if(guess === expected){
            naivecount++;
        }
    }

    console.log("machine learn:",count, "/", validInput.length);
    console.log("code algo", naivecount, "/", validInput.length);

}

module.exports.init = init;