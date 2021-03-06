page = "builder";
var adventurerIds = ["1500000013", "1500000015", "1500000016", "1500000017", "1500000018"];

const formulaByGoal = {
    "physicalDamage":                   {"type":"value","name":"physicalDamage"},
    "magicalDamage":                    {"type":"value","name":"magicalDamage"},
    "magicalDamageWithPhysicalMecanism":{"type":"value","name":"magicalDamageWithPhysicalMecanism"},
    "hybridDamage":                     {"type":"value","name":"hybridDamage"},
    "jumpDamage":                       {"type":"value","name":"jumpDamage"},
    "sprDamageWithPhysicalMecanism":    {"type":"value","name":"sprDamageWithPhysicalMecanism"},
    "sprDamageWithMagicalMecanism":     {"type":"value","name":"sprDamageWithMagicalMecanism"},
    "summonerSkill":                    {"type":"value","name":"summonerSkill"},
    "def":                              {"type":"value","name":"def"},
    "spr":                              {"type":"value","name":"spr"},
    "hp":                               {"type":"value","name":"hp"},
    "physicaleHp":                      {"type":"*", "value1":{"type":"value","name":"hp"}, "value2":{"type":"value","name":"def"}},
    "magicaleHp":                       {"type":"*", "value1":{"type":"value","name":"hp"}, "value2":{"type":"value","name":"spr"}},
    "physicalEvasion":                  {"type":"value","name":"evade.physical"},
    "magicalEvasion":                   {"type":"value","name":"evade.magical"},
    "mpRefresh":                        {"type":"*", "value1":{"type":"value","name":"mp"}, "value2":{"type":"value","name":"mpRefresh"}},
    "heal":                             {"type":"+", "value1":{"type":"/", "value1":{"type":"value","name":"spr"}, "value2":{"type":"constant", "value":2}}, "value2":{"type":"/", "value1":{"type":"value","name":"mag"}, "value2":{"type":"constant", "value":10}}},
};


const statsToDisplay = baseStats.concat(["evade.physical","evade.magical"]);

var customFormula;

var espers;
var espersByName = {};

var units;
var ownedUnits;

var onlyUseOwnedItems = false;
var onlyUseShopRecipeItems = false;
var exludeEventEquipment;
var excludeTMR5;
var excludeNotReleasedYet;
var excludePremium;
var excludeSTMR;
var includeTMROfOwnedUnits;
var includeTrialRewards;

var ennemyStats;

var builds = [];
var currentUnitIndex = 0;

var alreadyUsedItems = {};
var unstackablePinnedItems = [];
var alreadyUsedEspers = [];

var searchType = [];
var searchStat = "";
var currentItemSlot;

var searchableEspers;

var dataLoadedFromHash = false;

var conciseView = true;

var progressElement;
var progress;

const defaultItemsToExclude = ["409009000"];
var itemsToExclude = defaultItemsToExclude.slice(); // Ring of Dominion


var running = false;

var workers = [];
var workerWorkingCount = 0;
var processedCount = 0
var typeCombinationsCount;
var remainingTypeCombinations;
var dataStorage;
var bestiary;
var typeCombinationChunckSizeDefault = 2;
var typeCombinationChunckSize = typeCombinationChunckSizeDefault;

function build() {
    if (running) {
        for (var index = workers.length; index--; index) {
            workers[index].terminate();
        }   
        alert("The build calculation has been stopped. The best calculated result is displayed, but it may not be the overall best build.");
        console.timeEnd("optimize");
        initWorkers();
        workerWorkingCount = 0;
        running = false;
        $("#buildButton").text("Build !");
        return;
    }
    
    $(".buildLinks").addClass("hidden");
    
    if (!builds[currentUnitIndex].unit) {
        alert("Please select an unit");
        return;
    }   
    
    builds[currentUnitIndex].emptyBuild();
    
    readEnnemyStats();
    readGoal();
    
    calculateAlreadyUsedItems();
    readItemsExcludeInclude();
    readStatsValues();
    
    running = true;
    $("#buildButton").text("STOP");
    
    optimize();
}

function optimize() {
    console.time("optimize");
    progress = 0;
    progressElement.width("0%");
    progressElement.text("0%");
    progressElement.removeClass("finished");
    
    var forceDoubleHand = $("#forceDoublehand input").prop('checked');
    var forceDualWield = $("#forceDualWield input").prop('checked');
    var tryEquipSources = $("#tryEquipsources input").prop('checked');
    
    dataStorage.setUnitBuild(builds[currentUnitIndex]);
    dataStorage.itemsToExclude = itemsToExclude;
    dataStorage.prepareData(itemsToExclude, ennemyStats);
    for (var index = workers.length; index--; index) {
        workers[index].postMessage(JSON.stringify({
            "type":"setData", 
            "server": server,
            "espers":espersByName,
            "unit":builds[currentUnitIndex].unit, 
            "fixedItems":builds[currentUnitIndex].fixedItems, 
            "baseValues":builds[currentUnitIndex].baseValues,
            "innateElements":builds[currentUnitIndex].innateElements,
            "formula":builds[currentUnitIndex].formula,
            "dataByType":dataStorage.dataByType,
            "dataWithCondition":dataStorage.dataWithCondition,
            "dualWieldSources":dataStorage.dualWieldSources,
            "alreadyUsedEspers":alreadyUsedEspers,
            "useEspers":!onlyUseShopRecipeItems,
            "ennemyStats":ennemyStats
        }));
    }
    
    
    var typeCombinationGenerator = new TypeCombinationGenerator(forceDoubleHand, forceDualWield, tryEquipSources, builds[currentUnitIndex], dataStorage.dualWieldSources, dataStorage.equipSources, dataStorage.dataByType);
    remainingTypeCombinations = typeCombinationGenerator.generateTypeCombinations();
    
    typeCombinationChunckSize = Math.min(typeCombinationChunckSize, Math.ceil(remainingTypeCombinations.length/20));
    
    processedCount = 0
    typeCombinationsCount = remainingTypeCombinations.length;
    for (var index = workers.length; index--; index) {
        processTypeCombinations(index);
    }   
}

function processTypeCombinations(workerIndex) {
    if (remainingTypeCombinations.length == 0) {
        return;
    }
    var combinationsToProcess;
    if (typeCombinationChunckSize > remainingTypeCombinations.length) {
        combinationsToProcess = remainingTypeCombinations;
        remainingTypeCombinations = [];
    } else {
        combinationsToProcess = remainingTypeCombinations.slice(0,typeCombinationChunckSize);
        remainingTypeCombinations = remainingTypeCombinations.slice(typeCombinationChunckSize);
    }
    workers[workerIndex].postMessage(JSON.stringify({
        "type":"optimize", 
        "typeCombinations":combinationsToProcess
    }));
    workerWorkingCount++;
}

function calculateAlreadyUsedItems() {
    alreadyUsedItems = {};
    alreadyUsedInThisBuildItems = {};
    unstackablePinnedItems = [];
    alreadyUsedEspers = [];
    for (var i = 0, len = builds.length; i < len; i++) {
        if (i != currentUnitIndex) {
            var build = builds[i].build;
            for (var j = 0, len2 = build.length; j < len2; j++) {
                var item = build[j];
                if (item) {
                    if (alreadyUsedItems[item.id]) {
                        alreadyUsedItems[item.id]++;
                    } else {
                        alreadyUsedItems[item.id] = 1;
                    }
                }
            }
            if (build[10]) {
                alreadyUsedEspers.push(build[10].id);
            }
        } else {
            for (var index = 0; index < 10; index++) {
                if (builds[i].fixedItems[index]) {
                    var item = builds[i].fixedItems[index];
                    if (item) {
                        if (alreadyUsedItems[item.id]) {
                            alreadyUsedItems[item.id]++;
                        } else {
                            alreadyUsedItems[item.id] = 1;
                        }
                        if (!isStackable(item)) {
                            unstackablePinnedItems.push(item.id);
                        }
                    }   
                }
            }
            if (builds[i].build[10]) {
                alreadyUsedEspers.push(builds[i].build[10].id);
            }
        }
    }
}

function readGoal(index = currentUnitIndex) {
    var goal;
    if (customFormula) {
        builds[currentUnitIndex].goal = "custom";
        builds[currentUnitIndex].formula = customFormula;
    } else {
        goal = $(".goal select").val();   
        if (goal == "magicalDamage" && $(".magicalSkillType select").val() == "physicalMagic") {
            builds[currentUnitIndex].goal = "magicalDamageWithPhysicalMecanism";
        } else {
            builds[currentUnitIndex].goal = goal;
        }
        builds[currentUnitIndex].formula = formulaByGoal[builds[currentUnitIndex].goal];
    }
}

function readItemsExcludeInclude() {
    exludeEventEquipment = $("#exludeEvent").prop('checked');
    excludeTMR5 = $("#excludeTMR5").prop('checked');
    excludeNotReleasedYet = $("#excludeNotReleasedYet").prop('checked');
    excludePremium = $("#excludePremium").prop("checked");
    excludeSTMR = $("#excludeSTMR").prop("checked");
    onlyShopRecipe = $("#onlyShopRecipe").prop("checked");
    includeTMROfOwnedUnits = $("#includeTMROfOwnedUnits").prop("checked");
    includeTrialRewards = $("#includeTrialRewards").prop("checked");
}

function readStatsValues() {
    for (var index = baseStats.length; index--;) {
        builds[currentUnitIndex].baseValues[baseStats[index]] = {
            "base" : parseInt($(".unitStats .stat." + baseStats[index] + " .baseStat input").val()) || 0,
            "pots" : parseInt($(".unitStats .stat." + baseStats[index] + " .pots input").val()) || 0
        };
        builds[currentUnitIndex].baseValues[baseStats[index]].total = builds[currentUnitIndex].baseValues[baseStats[index]].base + builds[currentUnitIndex].baseValues[baseStats[index]].pots;
        builds[currentUnitIndex].baseValues[baseStats[index]].buff = parseInt($(".unitStats .stat." + baseStats[index] + " .buff input").val()) || 0;
    }
    var lbShardsPerTurn = parseInt($(".unitStats .stat.lbShardsPerTurn .buff input").val());
    if (isNaN(lbShardsPerTurn)) {
        lbShardsPerTurn = 4;
    }
    builds[currentUnitIndex].baseValues["lbFillRate"] = {
        "total" : lbShardsPerTurn,
        "buff" : parseInt($(".unitStats .stat.lbFillRate .buff input").val()) || 0
    };
    builds[currentUnitIndex].innateElements = getSelectedValuesFor("elements");
}



function getPlaceHolder(type) {
    return {"name":"Any " + type,"type":type, "placeHolder":true};
}
 

function readEnnemyStats() {
    var ennemyResist = {};
    for(var elementIndex = elementList.length; elementIndex--;) {
        var element = elementList[elementIndex];
        var value = $("#elementalResists td." + element + " input").val();
        if (value) {
            ennemyResist[element] = parseInt(value);
        } else {
            ennemyResist[element] = 0;
        }
    }
    var ennemyRaces = getSelectedValuesFor("races");
    var monsterDef = 100;
    var monsterSpr = 100;
    if ($("#monsterDef").val()) {
        monsterDef = parseInt($("#monsterDef").val());
    }
    if ($("#monsterSpr").val()) {
        monsterSpr = parseInt($("#monsterSpr").val());
    }
    ennemyStats = new EnnemyStats(getSelectedValuesFor("races"), monsterDef, monsterSpr, ennemyResist);
}

    
function getFixedItemItemSlot(item, equipable, fixedItems) {
    var slot = -1;
    var forceDoubleHand = $("#forceDoublehand input").prop('checked');
    if (weaponList.includes(item.type)) {
        if (fixedItems[0] && fixedItems[1]) {
            return -1;
        }
        if (!fixedItems[0]) {
            return 0;
        } else {
            if (!forceDoubleHand && equipable[1].includes(item.type)) {
                return 1;
            } else {
                return -1;
            }
        }
    } else if (shieldList.includes(item.type)) {    
        if (fixedItems[1]) {
            return -1;
        }
        return 1;
    } else if (headList.includes(item.type)) {    
        if (fixedItems[2]) {
            return -1;
        }
        return 2;
    } else if (bodyList.includes(item.type)) {    
        if (fixedItems[3]) {
            return -1;
        }
        return 3;
    } else if (item.type == "accessory") {
        if (fixedItems[4] && fixedItems[5]) {
            return -1;
        }
        if (!fixedItems[4]) {
            return 4;
        } else {
            return 5;
        }
    } else if (item.type == "materia") {
        if (fixedItems[6] && fixedItems[7] && fixedItems[8] && fixedItems[9]) {
            return -1;
        }
        if (!fixedItems[6]) {
            return 6;
        } else if (!fixedItems[7]) {
            return 7;
        } else if (!fixedItems[8]) {
            return 8;
        } else {
            return 9;
        }
    } else if (item.type == "esper") {
        return 10;
    }
    return slot;
}


function getAvailableNumber(item) {
    var number = 0;
    if (onlyUseOwnedItems) {
        number = getOwnedNumber(item).available;
    } else {
        if (onlyUseShopRecipeItems) {
            if (item.maxNumber || adventurerIds.includes(item.id)) {
                return 0;
            }
            var shopRecipe = false;
            for (var index = item.access.length; index--;) {
                var access = item.access[index];
                if (access.startsWith("recipe") || access == "shop") {
                    if (access.endsWith("event")) {
                        return 0;
                    }       
                    shopRecipe = true;
                    if (!exludeEventEquipment) {
                        break;
                    }
                } 
            }
            if (shopRecipe) {
                return 4;
            } else {
                return 0;
            }
        } else {
            if (excludeNotReleasedYet || excludeTMR5 || exludeEventEquipment || excludePremium || excludeSTMR) {
                for (var index = item.access.length; index--;) {
                    var access = item.access[index];
                    if ((excludeNotReleasedYet && access == "not released yet")
                       || (excludeTMR5 && access.startsWith("TMR-5*") && item.tmrUnit != builds[currentUnitIndex].unit.id)
                       || (exludeEventEquipment && access.endsWith("event"))
                       || (excludePremium && access == "premium")
                       || (excludeSTMR && access == "STMR")) {
                        return 0;
                    }        
                }
            }
            number = 4;
            if (item.maxNumber) {
                if (alreadyUsedItems[item.id]) {
                    number = item.maxNumber - alreadyUsedItems[item.id];
                } else {
                    number = item.maxNumber;
                }
            }
            if (!isStackable(item)) {
                if (unstackablePinnedItems.includes(item.id)) {
                    number = 0;
                } else {
                    number = 1;
                }
            }
        }
    }
    if (!isStackable(item)) {
        number = Math.min(number,1);
    }
    return number;
}

function getOwnedNumber(item) {
    var totalNumber = 0;
    var totalOwnedNumber = 0;
    var availableNumber = 0;
    if (itemInventory[item.id]) {
        totalNumber = itemInventory[item.id];
    }
    totalOwnedNumber = totalNumber;
    if (includeTMROfOwnedUnits) {
        if (item.tmrUnit && ownedUnits[item.tmrUnit]) {
            totalNumber += ownedUnits[item.tmrUnit].farmable;
        }
    }
    if (includeTrialRewards && totalNumber == 0 && item.access.includes("trial")) {
        totalNumber += 1;
    }
    
    if (alreadyUsedItems[item.id]) {
        availableNumber = Math.max(0, totalNumber - alreadyUsedItems[item.id]);
        if (!isStackable(item)) {
            if (unstackablePinnedItems.includes(item.id)) {
                availableNumber = 0
            } else {
                availableNumber = Math.min(1, availableNumber);
            }
        }
    } else{
        availableNumber = totalNumber;
    }
    return {"total":totalNumber,"available":availableNumber,"totalOwnedNumber":totalOwnedNumber};
}

function logCurrentBuild() {
    readStatsValues();
    readGoal();
    readEnnemyStats();
    logBuild(builds[currentUnitIndex].build);
}

function logBuild(build, value) {
    var html = "";
    //calculateAlreadyUsedItems();
    readItemsExcludeInclude();

    for (var index = 0; index < 11; index++) {
        redrawBuildLine(index);          
    }

    if (conciseView) {
        $("#buildResult").addClass("conciseView");
    } else {
        html = '<div class="tbody">' + html + '</div>';
        $("#buildResult").removeClass("conciseView");
    }

    //$("#buildResult").html(html);

    $("#resultStats > div").removeClass("statToMaximize");

    var link = Piramidata.getImageLink(builds[currentUnitIndex]);
    $(".imageLink").prop("href",link);
    $(".buildLinks").removeClass("hidden");

    $("#fixedItemsTitle").addClass("hidden");
    $("#resultStats").removeClass("hidden");
    var values = {};
    for (var statIndex = 0, len = statsToDisplay.length; statIndex < len; statIndex++) {
        var result = calculateStatValue(build, statsToDisplay[statIndex], builds[currentUnitIndex]);
        values[statsToDisplay[statIndex]] = result.total;
        $("#resultStats ." + escapeDot(statsToDisplay[statIndex]) + " .value").html(Math.floor(result.total));
        var bonusPercent;
        if (result.bonusPercent > statsBonusCap[server]) {
            bonusPercent = "<span style='color:red;' title='Only 300% taken into account'>" + result.bonusPercent + "%</span>";
        } else {
            bonusPercent = result.bonusPercent + "%";
        }
        if (baseStats.includes(statsToDisplay[statIndex])) {
            var equipmentFlatStatBonus = Math.floor((getEquipmentStatBonus(build, statsToDisplay[statIndex], false) - 1) * 100);
            if (equipmentFlatStatBonus > 0) {
                bonusPercent += "&nbsp;-&nbsp;";
                if (equipmentFlatStatBonus > 300) {
                    bonusPercent += "<span style='color:red;' title='Only 300% taken into account'>" + equipmentFlatStatBonus + "%</span>";
                } else {
                    bonusPercent += equipmentFlatStatBonus + "%";
                }
            }
        }
        $("#resultStats ." + escapeDot(statsToDisplay[statIndex]) + " .bonus").html(bonusPercent);
    }

    $("#resultStats .physicaleHp .value").html(Math.floor(values["def"] * values["hp"]));
    $("#resultStats .magicaleHp .value").html(Math.floor(values["spr"] * values["hp"]));
    $("#resultStats .mpRefresh .value").html(Math.floor(values["mp"] * calculateStatValue(build, "mpRefresh", builds[currentUnitIndex]).total / 100));
    $("#resultStats .lbPerTurn .value").html(calculateStatValue(build, "lbPerTurn", builds[currentUnitIndex]).total);
    var evoMagResult = calculateStatValue(build, "evoMag", builds[currentUnitIndex]).total;
    if (evoMagResult > 0) {
        $("#resultStats .evoMag").removeClass("hidden");
        $("#resultStats .evoMag .value").html(calculateStatValue(build, "evoMag", builds[currentUnitIndex]).total);    
    } else {
        $("#resultStats .evoMag").addClass("hidden");
    }
    
    for (var index in elementList) {
        $("#resultStats .resists .resist." + elementList[index] + " .value").text(calculateStatValue(build, "resist|" + elementList[index] + ".percent", builds[currentUnitIndex]).total + '%');
    }
    for (var index in ailmentList) {
        $("#resultStats .resists .resist." + ailmentList[index] + " .value").text(Math.min(100, calculateStatValue(build, "resist|" + ailmentList[index] + ".percent", builds[currentUnitIndex]).total) + '%');
    }
    if (builds[currentUnitIndex].goal == "physicaleHp" || builds[currentUnitIndex].goal == "magicaleHp") {
        $("#resultStats ." + builds[currentUnitIndex].goal).addClass("statToMaximize");
    }

    var importantStats = builds[currentUnitIndex].involvedStats;
    for (var index in importantStats) {
        $("#resultStats ." + escapeDot(importantStats[index])).addClass("statToMaximize");    
    }

    if (!value) {
        value = calculateBuildValue(build);
    }
    
    var physicalDamageResult = 0;
    var magicalDamageResult = 0;
    var hybridDamageResult = 0;
    var healingResult = 0;
    
    $("#resultStats .physicalDamageResult").addClass("hidden");
    $("#resultStats .magicalDamageResult").addClass("hidden");
    $("#resultStats .hybridDamageResult").addClass("hidden");
    $("#resultStats .healingResult").addClass("hidden");
    $("#resultStats .buildResult").addClass("hidden");
    if (importantStats.includes("atk")) {
        $("#resultStats .physicalDamageResult").removeClass("hidden");
        physicalDamageResult = calculateBuildValueWithFormula(build, builds[currentUnitIndex], ennemyStats, formulaByGoal["physicalDamage"]);
        $("#resultStats .physicalDamageResult .calcValue").text(Math.floor(physicalDamageResult));
    }
    if (importantStats.includes("mag")) {
        $("#resultStats .magicalDamageResult").removeClass("hidden");
        magicalDamageResult = calculateBuildValueWithFormula(build, builds[currentUnitIndex], ennemyStats, formulaByGoal["magicalDamage"]);
        $("#resultStats .magicalDamageResult .calcValue").text(Math.floor(magicalDamageResult));
    }
    if (importantStats.includes("atk") && importantStats.includes("mag")) {
        $("#resultStats .hybridDamageResult").removeClass("hidden");
        hybridDamageResult = calculateBuildValueWithFormula(build, builds[currentUnitIndex], ennemyStats, formulaByGoal["hybridDamage"]);
        $("#resultStats .hybridDamageResult .calcValue").text(Math.floor(hybridDamageResult));
    }
    if (importantStats.includes("mag") && importantStats.includes("spr")) {
        $("#resultStats .healingResult").removeClass("hidden");
        healingResult = calculateBuildValueWithFormula(build, builds[currentUnitIndex], ennemyStats, formulaByGoal["heal"]);
        $("#resultStats .healingResult .calcValue").text(Math.floor(healingResult));
    }
    if (value != physicalDamageResult && value != magicalDamageResult && value != hybridDamageResult && value != healingResult) {
        $("#resultStats .buildResult").removeClass("hidden");
        var valueToDisplay;
        if (value < 100) {
            valueToDisplay = Math.floor(value*10)/10;
        } else {
            valueToDisplay = Math.floor(value);
        }
        $("#resultStats .buildResult .calcValue").text(valueToDisplay);
    }
    $("#resultStats .monsterDefValue").text(" " + ennemyStats.def);
    $("#resultStats .monsterSprValue").text(" " + ennemyStats.spr);
    $("#resultStats .damageCoef").html("1x");
}

function switchView(conciseViewParam) {
    conciseView = conciseViewParam;
    if (conciseView) {
        $("#conciseViewLink").addClass("hidden");
        $("#detailedViewLink").removeClass("hidden");
    } else {
        $("#detailedViewLink").addClass("hidden");
        $("#conciseViewLink").removeClass("hidden");
    }
    logCurrentBuild();
}

function escapeDot(statName) {
    statName = statName.replace(/\./g, '_');
    return statName.replace(/\|/g, '_');
}

function getItemLine(index, short = false) {
    var html = "";
    
    var item = builds[currentUnitIndex].fixedItems[index];
    if (!item) {
        item = builds[currentUnitIndex].build[index];
    }
    
    if (index >= 0 && builds[currentUnitIndex].fixedItems[index]) {
        html += '<div class="td actions"><img class="pin fixed" title="Unpin this item" onclick="removeFixedItemAt(\'' + index +'\')" src="img/pinned.png"></img><img title="Remove this item" class="delete" onclick="removeItemAt(\'' + index +'\')" src="img/delete.png"></img></div>'
    } else if (!item) {
        html += '<div class="td actions"></div><div class="td type slot" onclick="displayFixItemModal(' + index + ');"><img src="img/'+ getSlotIcon(index) + '" class="icon"></img></div><div class="td name slot">'+ getSlotName(index) + '</div>'
    } else if (!item.placeHolder) {
        html += '<div class="td actions"><img title="Pin this item" class="pin notFixed" onclick="fixItem(\'' + item.id +'\',' + index + ',false);" src="img/pin.png"></img><img title="Remove this item" class="delete" onclick="removeItemAt(\'' + index +'\')" src="img/delete.png"></img>';
        if (item.type != "esper") {
            html += '<span title="Exclude this item from builds" class="excludeItem glyphicon glyphicon-ban-circle" onclick="excludeItem(\'' + item.id +'\')" />';
        }
        html += '</div>';
    } else {
        html += '<div class="td"></div>'
    }
    
    if (item) {
        if (short) {
            html += '<div class="change" onclick="displayFixItemModal(' + index + ');">' + getImageHtml(item) + '</div>' + getNameColumnHtml(item);
        } else {
            html += displayItemLine(item);
        }
        if (!item.placeHolder && index < 10 && onlyUseOwnedItems) {
            var alreadyUsed = 0;
            if (alreadyUsedItems[item.id]) {
                alreadyUsed = alreadyUsedItems[item.id];
            }
            alreadyUsed += getNumberOfItemAlreadyUsedInThisBuild(builds[currentUnitIndex], index, item);
            if (getOwnedNumber(item).totalOwnedNumber <= alreadyUsed && getOwnedNumber(item).total > alreadyUsed) {
                if (item.tmrUnit) {
                    html += '<div class="td"><span class="glyphicon glyphicon-screenshot" title="TMR you may want to farm. TMR of ' + units[item.tmrUnit].name + '"/></div>'
                } else if (item.access.includes("trial")) {
                    html += '<div class="td"><span class="glyphicon glyphicon-screenshot" title="Trial reward"/></div>'
                }
            }
        }
    }
    return html;
}

function getNumberOfItemAlreadyUsedInThisBuild(unitBuild, index, item) {
    var number = 0;
    for (var previousItemIndex = 0; previousItemIndex < index; previousItemIndex++) {
        if (unitBuild.build[previousItemIndex] && !unitBuild.fixedItems[previousItemIndex] && unitBuild.build[previousItemIndex].id && unitBuild.build[previousItemIndex].id == item.id) {
            number++;
        }
        
    }
    return number;
}

function getSlotIcon(index) {
    switch(index) {
        case 0:
            return "rightHandSlot.png";
        case 1:
            return "leftHandSlot.png";
        case 2:
            return "headSlot.png";
        case 3:
            return "bodySlot.png";
        case 4:
        case 5:
            return "accessorySlot.png";
        case 6:
        case 7:
        case 8:
        case 9:
            return "materiaSlot.png";
        case 10:
            return "esperSlot.png";
    }
}

function getSlotName(index) {
    switch(index) {
        case 0:
            return "Left hand";
        case 1:
            return "Right hand";
        case 2:
            return "Head";
        case 3:
            return "Body";
        case 4:
        case 5:
            return "Accessory";
        case 6:
        case 7:
        case 8:
        case 9:
            return "Materia";
        case 10:
            return "Esper";
    }
}

function redrawBuildLine(index) {
    $("#buildResult .buildLine_" + index).html(getItemLine(index, conciseView));
}

// Populate the unit html select with a line per unit
function populateUnitSelect() {
    var options = '<option value=""></option>';
    Object.keys(units).sort(function(id1, id2) {
        return units[id1].name.localeCompare(units[id2].name);
    }).forEach(function(value, index) {
        options += '<option value="'+ value + '">' + units[value].name + (units[value]["6_form"] ? ' ' + units[value].max_rarity + '★ ' : "") + '</option>';
        if (units[value]["6_form"]) {
            options += '<option value="'+ value + '-6">' + units[value].name + ' 6★</option>';
        }
    });
    $("#unitsSelect").html(options);
    $("#unitsSelect").change(onUnitChange);
    $('#unitsSelect').combobox();
}

function onUnitChange() {
    $( "#unitsSelect option:selected" ).each(function() {
        var unitId = $(this).val();
        var selectedUnitData;
        if (unitId.endsWith("-6")) {
            selectedUnitData = units[unitId.substr(0,unitId.length-2)]["6_form"];
        } else {
            selectedUnitData = units[unitId];    
        }
        if (selectedUnitData) {
            $("#unitTabs .tab_" + currentUnitIndex + " a").html(selectedUnitData.name);
            reinitBuild(currentUnitIndex);
            builds[currentUnitIndex].setUnit(selectedUnitData);
            updateUnitStats();
            dataStorage.setUnitBuild(builds[currentUnitIndex]);
            $("#help").addClass("hidden");
            recalculateApplicableSkills();
            logCurrentBuild();
        } else {
            builds[currentUnitIndex].setUnit(null);
            reinitBuild(currentUnitIndex); 
            updateUnitStats();
        }
        displayUnitRarity(selectedUnitData);
    });
}

function updateUnitStats() {
    $(baseStats).each(function (index, stat) {
        if (builds[currentUnitIndex].unit) {
            $(".unitStats .stat." + stat + " .baseStat input").val(builds[currentUnitIndex].unit.stats.maxStats[stat]);
            if (builds[currentUnitIndex].baseValues[stat]) {
                $(".unitStats .stat." + stat + " .pots input").val(builds[currentUnitIndex].baseValues[stat].pots);
                $(".unitStats .stat." + stat + " .buff input").val(builds[currentUnitIndex].baseValues[stat].buff);
            } else {
                $(".unitStats .stat." + stat + " .pots input").val(builds[currentUnitIndex].unit.stats.pots[stat]);
            }
        } else {
            $(".unitStats .stat." + stat + " .baseStat input").val("");
            $(".unitStats .stat." + stat + " .pots input").val("");
        }
    });
    if (builds[currentUnitIndex].unit && builds[currentUnitIndex].baseValues["lbFillRate"]) {
        $(".unitStats .stat.lbFillRate .buff input").val(builds[currentUnitIndex].baseValues["lbFillRate"].buff);
        $(".unitStats .stat.lbShardsPerTurn .buff input").val(builds[currentUnitIndex].baseValues["lbFillRate"].total);
    } else {
        $(".unitStats .stat.lbFillRate .buff input").val("");
        $(".unitStats .stat.lbShardsPerTurn .buff input").val("");
    }
    populateUnitEquip();
    if (builds[currentUnitIndex].unit) {
        for (var index in builds[currentUnitIndex].unit.equip) {
            $(".unitEquipable img." + builds[currentUnitIndex].unit.equip[index]).removeClass("notEquipable");
        }
    }
    if (builds[currentUnitIndex].unit) {
        $("#pleaseSelectUnitMessage").addClass("hidden");
        $("#buildDiv").removeClass("hidden");
        $(".buildDiv").removeClass("hidden");
        $("#resultStats").removeClass("hidden");
        $(".buildLinks").removeClass("hidden");
        $("#buildResult").removeClass("hidden");
        $("#unitLink").prop("href",toUrl(builds[currentUnitIndex].unit.name));
        $("#unitLink").removeClass("hidden");
    } else {
        $("#unitTabs .tab_" + currentUnitIndex + " a").html("Select unit");
        $("#pleaseSelectUnitMessage").removeClass("hidden");
        $(".buildDiv").addClass("hidden");
        $("#resultStats").addClass("hidden");
        $(".buildLinks").addClass("hidden");
        $("#buildResult").addClass("hidden");
        $("#unitLink").addClass("hidden");
    }
    readStatsValues();
}

function reinitBuild(buildIndex) {
    builds[buildIndex] = new UnitBuild(null, [null, null, null, null, null, null, null, null,null,null,null], {});
    readGoal(buildIndex);
}

function loadBuild(buildIndex) {
    currentUnitIndex = buildIndex;
    var build = builds[buildIndex];
    
    $("#unitsSelect option").prop("selected", false);
    if (build.unit) {
        $('#unitsSelect option[value="' + build.unit.id + '"]').prop("selected", true);
    }
    $("#unitsSelect").combobox("refresh");
    $(".unitAttackElement div.elements label").removeClass("active");
    if (build.innateElements) {
        for (var i in build.innateElements) {
            $(".unitAttackElement div.elements label:has(input[value=" + build.innateElements[i] + "])").addClass("active");
        }
    }
    
    $(".goal option").prop("selected", false);
    if (build.goal) {
        if (build.goal == "custom") {
            customFormula = build._formula;
        } else {
            customFormula = null;
            if (build.goal == "magicalDamageWithPhysicalMecanism") {
                $('.goal option[value="magicalDamage"]').prop("selected", true);   
            } else {
                $('.goal option[value="' + build.goal + '"]').prop("selected", true);
            }
        }
    }
    $(".magicalSkillType option").prop("selected", false);
    if (build.goal == "magicalDamage") {
        $('.magicalSkillType option[value="normal"]').prop("selected", true);
    } else if (build.goal == "magicalDamageWithPhysicalMecanism") {
        $('.magicalSkillType option[value="physicalMagic"]').prop("selected", true);
    }
    
    updateUnitStats();
    
    onGoalChange();
    
    
    if (builds[currentUnitIndex].unit) {
        logCurrentBuild();  
    }
}

function addNewUnit() {
    $("#unitTabs li").removeClass("active");
    $("#unitTabs .tab_" + (builds.length - 1)).after("<li class='active tab_" + builds.length + "'><a href='#' onclick='selectUnitTab(" + builds.length + ")'>Select unit</a></li>");
    builds.push(null);
    reinitBuild(builds.length - 1);
    $('#forceDoublehand input').prop('checked', false);
    $('#forceDualWield input').prop('checked', false);
    $('#tryEquipSources input').prop('checked', false);
    loadBuild(builds.length - 1);
    if (builds.length > 9) {
        $("#addNewUnitButton").addClass("hidden");
    }
    $("#unitsSelect").combobox("clearElement");
}

function selectUnitTab(index) {
    $("#unitTabs li").removeClass("active");
    $("#unitTabs .tab_" + index).addClass("active");
    loadBuild(index);
}

// Displays selected unit's rarity by stars
var displayUnitRarity = function(unit) {
    var rarityWrapper = $('.unit-rarity');
    if (unit) {
        var rarity = unit.max_rarity;

        rarityWrapper.show();
        rarityWrapper.empty();

        for (var i = 0; i < rarity; i++) {
            rarityWrapper.append('<i class="rarity-star" />');
        }
    } else {
        rarityWrapper.hide();
    }
};

function inventoryLoaded() {
    $(".equipments select option[value=owned]").prop("disabled", false);
    if (!dataLoadedFromHash) {
        $(".equipments select").val("owned");
        onEquipmentsChange();
    }
    
    var data = readStateHashData();
    
    if (data && data.equipmentToUse == "owned") {
        loadStateHashAndBuild(data);    
    }
}

function notLoaded() {
    var data = readStateHashData();
    
    if (data && data.equipmentToUse == "owned") {
        alert("The link you opened require you to be logged in the be able to be displayed. Please log in");
    }
}

function onGoalChange() {
    readGoal();
    if (builds[currentUnitIndex].unit) { 
        logCurrentBuild();
    }
    var goal = builds[currentUnitIndex].goal;
    $(".monster").addClass("hidden");
    $(".unitAttackElement").addClass("hidden");
    $(".magicalSkillType").addClass("hidden");
    if (builds[currentUnitIndex].involvedStats.includes("physicalKiller") 
        || builds[currentUnitIndex].involvedStats.includes("magicalKiller")
        || builds[currentUnitIndex].involvedStats.includes("weaponElement")) {
        $(".monster").removeClass("hidden");
        $(".unitAttackElement").removeClass("hidden");
    }
    if (builds[currentUnitIndex].involvedStats.includes("weaponElement")) {
        $(".unitAttackElement").removeClass("hidden");
    }
    if (goal == "magicalDamage") {
        $(".magicalSkillType").removeClass("hidden");
    }
    
    if (customFormula) {
        $('#normalGoalChoices').addClass("hidden");
        $('#customGoalChoice').removeClass("hidden");
        $("#customGoalFormula").text(formulaToString(customFormula));
    } else {
        $('#normalGoalChoices').removeClass("hidden");
        $('#customGoalChoice').addClass("hidden");
    }
}

function openCustomGoalModal() {
    $("#customFormulaModal").modal();
}

function chooseCustomFormula() {
    var formulaString = $("#customFormulaModal input").val();
    var formula = parseFormula(formulaString);
    if (formula) {
        customFormula = formula;
        builds[currentUnitIndex].goal = "custom";
        $('#customFormulaModal').modal('hide');
        onGoalChange();
    }
}

function addToCustomFormula(string) {
    $("#customFormulaModal input").val($("#customFormulaModal input").val() + string);
}

function removeCustomGoal() {
    customFormula = null;
    onGoalChange();
    $('#customFormulaModal').modal('hide');
}

function onEquipmentsChange() {
    var equipments = $(".equipments select").val();
    if (equipments == "all") {
        $("#exludeEvent").parent().removeClass("hidden");
        $("#excludePremium").parent().removeClass("hidden");
        $("#excludeTMR5").parent().removeClass("hidden");
        $("#excludeNotReleasedYet").parent().removeClass("hidden");
        if (server == "JP") {
            $("#excludeSTMR").parent().removeClass("hidden");
        }
        $("#includeTMROfOwnedUnits").parent().addClass("hidden");
        $("#includeTrialRewards").parent().addClass("hidden");
        onlyUseOwnedItems = false;
        onlyUseShopRecipeItems = false;
    } else if (equipments == "owned") {
        $("#exludeEvent").parent().addClass("hidden");
        $("#excludePremium").parent().addClass("hidden");
        $("#excludeTMR5").parent().addClass("hidden");
        $("#excludeNotReleasedYet").parent().addClass("hidden");
        $("#excludeSTMR").parent().addClass("hidden");
        if (ownedUnits && Object.keys(ownedUnits).length > 0) {
            $("#includeTMROfOwnedUnits").parent().removeClass("hidden");
        } else {
            $("#includeTMROfOwnedUnits").parent().addClass("hidden");
        }
        $("#includeTrialRewards").parent().removeClass("hidden");
        onlyUseOwnedItems = true;
        onlyUseShopRecipeItems = false;
    } else {
        $("#exludeEvent").parent().addClass("hidden");
        $("#excludePremium").parent().addClass("hidden");
        $("#excludeTMR5").parent().addClass("hidden");
        $("#excludeNotReleasedYet").parent().addClass("hidden");
        if (server == "JP") {
            $("#excludeSTMR").parent().addClass("hidden");
        }
        $("#includeTMROfOwnedUnits").parent().addClass("hidden");
        $("#includeTrialRewards").parent().addClass("hidden");
        onlyUseOwnedItems = false;
        onlyUseShopRecipeItems = true;
    }
    updateEspers();
}
     
function updateSearchResult() {
    var searchText = $("#searchText").val();
    if ((searchText == null || searchText == "") && searchType.length == 0 && searchStat == "") {
        $("#fixItemModal .results .tbody").html("");    
        return;
    }
    var types = searchType;
    if (searchType.length == 0) {
        types = builds[currentUnitIndex].getCurrentUnitEquip().concat("esper");
    }
    var baseStat = 0;
    if (baseStats.includes(searchStat)) {
        baseStat = builds[currentUnitIndex].baseValues[searchStat].total;
    }
    accessToRemove = [];
    
    var dataWithOnlyOneOccurence = searchableEspers.slice();
    for (var index = 0, len = dataStorage.data.length; index < len; index++) {
        var item = dataStorage.data[index];
        if (!isApplicable(item, builds[currentUnitIndex].unit)) {
            // Don't display not applicable items
            continue;
        }
        if (dataWithOnlyOneOccurence[dataWithOnlyOneOccurence.length - 1].id == item.id) {
            var previousItem = dataWithOnlyOneOccurence[dataWithOnlyOneOccurence.length - 1];
            if (previousItem.equipedConditions) {
                if (item.equipedConditions) {
                    if (previousItem.equipedConditions.length <= item.equipedConditions.length && areConditionOK(item, builds[currentUnitIndex].build)) {
                        dataWithOnlyOneOccurence[dataWithOnlyOneOccurence.length - 1] = item;
                    }
                }
            } else {
                if (areConditionOK(item, builds[currentUnitIndex].build)) {
                    dataWithOnlyOneOccurence[dataWithOnlyOneOccurence.length - 1] = item;
                }
            }
        } else {
            dataWithOnlyOneOccurence.push(item);
        }
    }
    
    displaySearchResults(sort(filter(dataWithOnlyOneOccurence, false, searchStat, baseStat, searchText, builds[currentUnitIndex].unit.id, types, [], [], [], [], "", false, true)));
    
    if (searchStat == "") {
        $("#fixItemModal .results").addClass("notSorted");
    } else {
        $("#fixItemModal .results .thead .sort").text(searchStat.toUpperCase());    
        $("#fixItemModal .results").removeClass("notSorted");
    }
    
    $("#fixItemModal .results .tbody").unmark({
        done: function() {
            if (searchText && searchText.length != 0) {
                searchText.split(" ").forEach(function (token) {
                    $("#fixItemModal .results .tbody").mark(token);
                });
            }
        }
    });
}

function displayFixItemModal(index) {
    if (!builds[currentUnitIndex].unit) {
        alert("Please select an unit");
        return;
    }
    
    builds[currentUnitIndex].prepareEquipable();
    if (builds[currentUnitIndex].equipable[index].length == 0) {
        alert("Nothing can be added at this slot");
        return;
    }
    currentItemSlot = index;
    
    populateItemType(builds[currentUnitIndex].equipable[index]);
    
    calculateAlreadyUsedItems();
    $("#searchText").val("");
    $("#fixItemModal .results .tbody").html("");
    
    $("#fixItemModal").modal();
    selectSearchStat(searchStat);
    selectSearchType(builds[currentUnitIndex].equipable[index]);
    updateSearchResult();
}

function fixItem(key, slotParam = -1) {
    var item;
    if (typeList.includes(key)) {
        item = getPlaceHolder(key);
    } else if (espersByName[key])  {
        item = espersByName[key];
    } else {
        item = findBestItemVersion(builds[currentUnitIndex].build, dataStorage.allItemVersions[key][0], dataStorage.itemWithVariation, builds[currentUnitIndex].unit);
    }
    
    if (item) {
        builds[currentUnitIndex].prepareEquipable();
        var slot = slotParam;
        if (slot == -1) {
            slot = getFixedItemItemSlot(item, builds[currentUnitIndex].equipable, builds[currentUnitIndex].fixedItems);
        }
        if (slot == -1) {
            if (weaponList.includes(item.type) && builds[currentUnitIndex].fixedItems[0] && !builds[currentUnitIndex].fixedItems[1]) {
                // for weapon, if the second weapon were refused, check if an innat partial DW allow it
                var innatePartialDualWield = builds[currentUnitIndex].getPartialDualWield();
                if (innatePartialDualWield && innatePartialDualWield.includes(item.type)) {
                    slot = 1;
                } else {
                    alert("No more slot available for this item. Select another item or remove fixed item of the same type.");
                    return;
                }
            } else {
                alert("No more slot available for this item. Select another item or remove a pinned item of the same type.");
                return;
            }
        }
        if (!isStackable(item)) {
            for(var index = 6; index < 10; index++) {
                if (index != slot && builds[currentUnitIndex].build[index]&& builds[currentUnitIndex].build[index].id == item.id) {
                    alert("This materia is not stackable. You cannot add another one");
                    return;
                }
            }
        }
        if (builds[currentUnitIndex].build[slot] && builds[currentUnitIndex].build[slot].id != item.id) {
            removeItemAt(slot);
        }
        if (item.originalItem) {
            var tmrSkillAlreadyUsed = false;
            for (var index = 0; index < 10; index++) {
                if (builds[currentUnitIndex].build[index] && builds[currentUnitIndex].build[index].originalItem) {
                    tmrSkillAlreadyUsed = true;
                    break;
                }
            }
            if (tmrSkillAlreadyUsed) {
                item = item.originalItem;
            }
        }
        builds[currentUnitIndex].fixedItems[slot] = item;
        builds[currentUnitIndex].build[slot] = item;
        if (slot < 10) {
            for (var index = 0; index < 10; index++) {
                if (index != slot) {
                    var itemTmp = builds[currentUnitIndex].build[index];
                    if (itemTmp  && !itemTmp.placeHolder && index != slot) {
                        var bestItemVersion = findBestItemVersion(builds[currentUnitIndex].build, itemTmp, dataStorage.itemWithVariation, builds[currentUnitIndex].unit);
                        
                        if (builds[currentUnitIndex].fixedItems[index]) {
                            builds[currentUnitIndex].fixedItems[index] = bestItemVersion;
                        }
                        builds[currentUnitIndex].build[index] = bestItemVersion;
                    }
                }
            }
        }
        recalculateApplicableSkills();
        logCurrentBuild();
    }
    $('#fixItemModal').modal('hide');
}

function removeFixedItemAt(slot) {
    builds[currentUnitIndex].fixedItems[slot] = null;
    var equip = builds[currentUnitIndex].getCurrentUnitEquip();
    for (var index = 0; index < 10; index++) {
        var item = builds[currentUnitIndex].fixedItems[index];
        if (item) {
            if (!equip.includes(item.type)) {
                removeFixedItemAt(index);
            } else {
                builds[currentUnitIndex].fixedItems[index] = findBestItemVersion(builds[currentUnitIndex].fixedItems, item, dataStorage.itemWithVariation, builds[currentUnitIndex].unit);
            }
        }
    }
    logCurrentBuild();
}

function removeItemAt(slot) {
    builds[currentUnitIndex].fixedItems[slot] = null;
    builds[currentUnitIndex].build[slot] = null;
    builds[currentUnitIndex].prepareEquipable();
    
    var tmrSkillAlreadyUsed = false;
    for (var index = 0; index < 10; index++) {
        if (builds[currentUnitIndex].build[index] && builds[currentUnitIndex].build[index].originalItem) {
            tmrSkillAlreadyUsed = true;
            break;
        }
    }
    
    for (var index = 0; index < 10; index ++) {
        var item = builds[currentUnitIndex].build[index];
        if (item && !item.placeHolder) {
            if (!builds[currentUnitIndex].equipable[index].includes(item.type)) {
                removeItemAt(index);
            } else {
                var bestItemVersion = findBestItemVersion(builds[currentUnitIndex].build, item, dataStorage.itemWithVariation, builds[currentUnitIndex].unit);
                if (!tmrSkillAlreadyUsed) {
                    bestItemVersion = getItemWithTmrSkillIfApplicable(bestItemVersion, builds[currentUnitIndex].unit);
                    if (bestItemVersion.originalItem) {
                        tmrSkillAlreadyUsed = true;
                    }
                }
                builds[currentUnitIndex].build[index] = bestItemVersion;
                if (builds[currentUnitIndex].fixedItems[index]) {
                    builds[currentUnitIndex].fixedItems[index] = builds[currentUnitIndex].build[index];
                }
            }
        }
    }
    recalculateApplicableSkills();
    logCurrentBuild();
}

function excludeItem(itemId) {
    if (!itemsToExclude.includes(itemId)) {
        for (var index = 0; index < 10; index++) {
            if (builds[currentUnitIndex].build[index] && builds[currentUnitIndex].build[index].id == itemId) {
                removeItemAt(index);
            }
        }
        itemsToExclude.push(itemId);
    }
    $(".excludedItemNumber").html(itemsToExclude.length);
}

function recalculateApplicableSkills() {
    builds[currentUnitIndex].build = builds[currentUnitIndex].build.slice(0,11);
    for (var skillIndex = builds[currentUnitIndex].unit.skills.length; skillIndex--;) {
        var skill = builds[currentUnitIndex].unit.skills[skillIndex];
        if (areConditionOK(skill, builds[currentUnitIndex].build)) {
            builds[currentUnitIndex].build.push(skill);
        }
    }
}

function selectSearchType(types) {
    $("#fixItemModal .modal-body .nav.type li").removeClass("active");
    searchType = types;
    if (types.length > 1) {
        $("#fixItemModal .modal-body .nav.type li.all").addClass("active");
    } else {
        $("#fixItemModal .modal-body .nav.type li." + types[0]).addClass("active");
    }
}

function selectSearchStat(stat) {
    if (!stat) {
        searchStat = "";
        $("#fixItemModal .modal-header .stat .dropdown-toggle").prop("src","img/sort-a-z.png");
    } else {
        searchStat = stat;
        $("#fixItemModal .modal-header .stat .dropdown-toggle").prop("src","img/sort-" + stat + ".png");
    }
}

var displaySearchResults = function(items) {
    if (itemInventory) {
        $("#fixItemModal").removeClass("notLoggedIn");
    } else {
        $("#fixItemModal").addClass("notLoggedIn");
    }
    var html = "";
    for (var index in items) {
        var item = items[index];
        if (item) {
            html += '<div class="tr selectable" onclick="fixItem(\'' + item.id + '\', ' + currentItemSlot + ')">';
            html += displayItemLine(item);
            if (itemInventory) {
                var notEnoughClass = "";
                var numbers = getOwnedNumber(item);
                var owned = "";
                if (numbers.total > 0) {
                    owned += numbers.available;
                    if (numbers.available != numbers.total) {
                        owned += "/" + numbers.total;   
                        if (numbers.available == 0) {
                            notEnoughClass = " notEnough ";
                        }
                    }
                }
                html+= "<div class='td inventory text-center'><span class='badge" + notEnoughClass + "'>" + owned + "</span></div>";
            } else {
                html+= "<div class='td inventory'/>"
            }
            html += "</div>";
        }
    }
    
    $("#fixItemModal .results .tbody").html(html);
}

function getStateHash() {
    var data = {
        "goal": builds[currentUnitIndex].goal,
        "innateElements":getSelectedValuesFor("elements")
    };

    if (data.goal == "magicalDamage") {
        data.attackType = $(".magicalSkillType select").val();
    }
    if (data.goal == "physicalDamage" || data.goal == "magicalDamage" || data.goal == "magicalDamageWithPhysicalMecanism" || data.goal == "hybridDamage" || data.goal == "jumpDamage" || data.goal == "sprDamageWithPhysicalMecanism" || data.goal == "custom") {
        data.ennemyRaces = getSelectedValuesFor("races");
        readEnnemyStats();
        data.ennemyResists = ennemyStats.elementalResists;
        data.monsterDef = ennemyStats.def;
        data.monsterSpr = ennemyStats.spr;
    }
    
    if (builds[currentUnitIndex].unit) {
        data.unit = builds[currentUnitIndex].unit.id;
        data.rarity = builds[currentUnitIndex].unit.max_rarity;
    }
    
    
    data.equipmentToUse = $(".equipments select").val();
    if (data.equipmentToUse == "all") {
        data.exludeEventEquipment = $("#exludeEvent").prop('checked');
        data.excludeTMR5 = $("#excludeTMR5").prop('checked');
        data.excludeNotReleasedYet = $("#excludeNotReleasedYet").prop('checked');
        data.excludePremium = $("#excludePremium").prop('checked');
        data.excludeSTMR = $("#excludeSTMR").prop('checked');
    }
    
    for (var index = 0; index < 10; index++) {
        var item = builds[currentUnitIndex].fixedItems[index];
        if (item && !item.placeHolder) {
            if (!data.fixedItems) data.fixedItems = [];
            data.fixedItems.push(item.id);
        }
    }
    
    if (builds[currentUnitIndex].build[10]) {
        data.esper = builds[currentUnitIndex].build[10].name;
    }
    
    if (data.goal == "custom") {
        data.customFormula = formulaToString(builds[currentUnitIndex].formula);
    }
    
    data.pots = {};
    data.buff = {};
    for (var index = baseStats.length; index--;) {
        data.pots[baseStats[index]] = builds[currentUnitIndex].baseValues[baseStats[index]].pots;
        data.buff[baseStats[index]] = builds[currentUnitIndex].baseValues[baseStats[index]].buff;
    }
    data.buff.lbFillRate = builds[currentUnitIndex].baseValues.lbFillRate.buff;
    data.lbShardsPerTurn = builds[currentUnitIndex].baseValues.lbFillRate.total;
    
    return data;
}

function readStateHashData() {
    if (window.location.hash.length > 1) {
        return JSON.parse(atob(window.location.hash.substr(1)));
    } else {
        return null;
    }
}
    
function loadStateHashAndBuild(data) {
    
    if (data.equipmentToUse == "owned" && !itemInventory) {
        return;
    }
    
    reinitBuild(0);
    $('.goal select option').prop("selected", false);
    $('.goal select option[value="' + data.goal + '"]').prop("selected", true);
    if (data.customFormula) {
        customFormula = parseFormula(data.customFormula);
    }
    onGoalChange();
    var unitId = data.unit;
    if (data.unitName) {
        for (var unitId in units) {
            if (units[unitId].name == data.unitName) {
                break;
            }
        }
    }
    if (data.rarity == 6 && units[unitId]["6_form"]) {
        $('#unitsSelect option[value="' + unitId + '-6"]').prop("selected", true);
    } else {
        $('#unitsSelect option[value="' + unitId + '"]').prop("selected", true);
    }
    $("#unitsSelect").combobox("refresh");
    onUnitChange();        
    
    select("elements", data.innateElements);
    if (data.goal == "mag" || data.goal == "magicalDamage") {
        $('.magicalSkillType select option[value="' + data.attackType + '"]').prop("selected", true);
    }
    select("races", data.ennemyRaces);
    for (var element in data.ennemyResists) {
        if (data.ennemyResists[element] == 0) {
            $("#elementalResists ." + element + " input").val("");
        } else {
            $("#elementalResists ." + element + " input").val(data.ennemyResists[element]);
        }
    }
    $('.equipments select option[value="' + data.equipmentToUse + '"]').prop("selected", true);
    if (data.equipmentToUse == "all") {
        $("#exludeEvent").prop('checked', data.exludeEventEquipment);
        $("#excludeTMR5").prop('checked', data.excludeTMR5);
        $("#excludeNotReleasedYet").prop('checked', data.excludeNotReleasedYet);
        $("#excludePremium").prop("checked", data.excludePremium);
        $("#excludeSTMR").prop("checked", data.excludeSTMR);
    }
    if (data.fixedItems) {
        for (var index in data.fixedItems) {
            if (data.fixedItems[index]) {
                fixItem(data.fixedItems[index]);
            }
        }
    }
    if (data.monsterDef) {
        $("#monsterDef").val(data.monsterDef);
    }
    if (data.monsterSpr) {
        $("#monsterSpr").val(data.monsterSpr);
    }
    if (data.esper) {
        fixItem(data.esper);
    }
    if (data.pots) {
        for (var index = baseStats.length; index--;) {
            $(".unitStats .stat." + baseStats[index] + " .pots input").val(data.pots[baseStats[index]]);
        }
    }
    if (data.buff) {
        for (var index = baseStats.length; index--;) {
            $(".unitStats .stat." + baseStats[index] + " .buff input").val(data.buff[baseStats[index]]);
        }
        if (data.buff.lbFillRate) {
            $(".unitStats .stat.lbFillRate .buff input").val(data.buff.lbFillRate);
        }
    }
    if (data.lbShardsPerTurn) {
        $(".unitStats .stat.lbShardsPerTurn .buff input").val(data.lbShardsPerTurn);
    }
    dataLoadedFromHash = true;
    window.location.hash = "";
    if (data.runBuild) {
        build();
    } else {
        logCurrentBuild();
    }
}

function showBuildLink() {
    var data = getStateHash();
    data.fixedItems = [];
    
    // first fix allow Us of items
    for (var index = 0; index < 10; index++) {
        var item = builds[currentUnitIndex].build[index];
        if (item && !item.placeHolder && item.allowUseOf) {
            data.fixedItems.push(item.id);
        }
    }
    // first fix dual wield items
    for (var index = 0; index < 10; index++) {
        var item = builds[currentUnitIndex].build[index];
        if (item && !item.placeHolder && hasDualWieldOrPartialDualWield(item)) {
            data.fixedItems.push(item.id);
        }
    }
    // then others items
    for (var index = 0; index < 10; index++) {
        var item = builds[currentUnitIndex].build[index];
        if (item && !item.placeHolder && !hasDualWieldOrPartialDualWield(item) && !item.allowUseOf) {
            data.fixedItems.push(item.id);
        }
        if (item && item.placeHolder) {
            data.fixedItems.push(item.type);
        }
    }
    data.equipmentToUse = "all";
    getShortUrl("http://ffbeEquip.lyrgard.fr/builder.html?server=" + server + "#" + btoa(JSON.stringify(data)), function(shortUrl) {
        $('<div id="showLinkDialog" title="Build Link">' + 
            '<input value="' + shortUrl + '"></input>' +
            '<h4>This link will open the builder with this exact build displayed</h4>' +
          '</div>' ).dialog({
            modal: true,
            open: function(event, ui) {
                $(this).parent().css('position', 'fixed');
                $("#showLinkDialog input").select();
                try {
                    var successful = document.execCommand('copy');
                    if (successful) {
                        $("#showLinkDialog input").after("<div>Link copied to clipboard<div>");
                    } else {
                        console.log('Oops, unable to copy');    
                    }
                } catch (err) {
                    console.log('Oops, unable to copy');
                }
            },
            position: { my: 'top', at: 'top+150' },
            width: 600
        });
    });
}
      
function showBuilderSetupLink() {
    var data = getStateHash();
    data.runBuild = true;
    getShortUrl("http://ffbeEquip.lyrgard.fr/builder.html#" + btoa(JSON.stringify(data)), function(shortUrl) {
        $('<div id="showBuilderSetupLinkDialog" title="Builder setup Link">' + 
            '<input value="' + shortUrl + '"></input>' +
            '<h4>The following information are stored in this link :</h4>' +
            '<ul><li>The goal of the current unit</li><li>The currently selected unit, if any, and related information</li><li>Information about the monster (race and elemental resist)</li><li>The choice of equipments to use</li><li>The items that has been pinned in the build</li></ul>' +
            '<h4>Upon opening the link, those information will be restored, and if possible a build will be launched.</h4>' +
          '</div>' ).dialog({
            modal: true,
            open: function(event, ui) {
                $(this).parent().css('position', 'fixed');
                $("#showBuilderSetupLinkDialog input").select();
                try {
                    var successful = document.execCommand('copy');
                    if (successful) {
                        $("#showBuilderSetupLinkDialog input").after("<div>Link copied to clipboard<div>");
                    } else {
                        console.log('Oops, unable to copy');    
                    }
                } catch (err) {
                    console.log('Oops, unable to copy');
                }
            },
            position: { my: 'top', at: 'top+150' },
            width: 600
        });
    });
    
}

function showBuildAsText() {
    var text = "";
    text += 
        builds[currentUnitIndex].unit.name + ' ' + builds[currentUnitIndex].unit.max_rarity + '★\n' +
        getItemLineAsText("Right hand", 0) +
        getItemLineAsText("Left hand", 1) +
        getItemLineAsText("Head", 2) +
        getItemLineAsText("Body", 3) +
        getItemLineAsText("Accessory 1", 4) +
        getItemLineAsText("Accessory 2", 5) +
        getItemLineAsText("Materia 1", 6) +
        getItemLineAsText("Materia 2", 7) +
        getItemLineAsText("Materia 3", 8) +
        getItemLineAsText("Materia 4", 9) +
        getItemLineAsText("Esper", 10) +
        getBuildStatsAsText();
        
    showTextPopup("Build as text", text);
}

function showExcludedItems() {
    
    var text = "";
    var idAlreadyTreated = [];
    for (var index = 0, len = data.length; index < len; index++) {
        var item = data[index];
        if (itemsToExclude.includes(item.id) && !idAlreadyTreated.includes(item.id)) {
            text += '<div class="tr id_' + item.id +'">' +
                '<div class="td actions"><span class="excludeItem glyphicon glyphicon-remove" onclick="removeItemFromExcludeList(\'' + item.id +'\')"></span></div>' +
                getImageHtml(item) + 
                getNameColumnHtml(item) + 
                '</div>';
            idAlreadyTreated.push(item.id);
        }
    }
        
    $('<div id="showExcludedItemsDialog" title="Excluded items">' + 
        '<a class="buttonLink" onclick="resetExcludeList();">Reset item exclusion list</a>' +
        '<div class="table items">' + text + '</div>' +
      '</div>' ).dialog({
        modal: true,
        position: { my: 'top', at: 'top+150', of: $("body") },
        width: 600
    });
}

function showMonsterList() {
    var text = "";
    for (var index = 0, len = bestiary.monsters.length; index < len; index++) {
        var monster = bestiary.monsters[index];
        text += '<div class="tr" onclick="selectMonster(' + index +')">' +
            getNameColumnHtml(monster) + 
            '<div class="td special">' + getResistHtml(monster) + '</div>' + 
            '<div class="td special">' + getSpecialHtml(monster) + '</div>';
        text += '<div class="td access">';
        for (var raceIndex = 0, racesLen = monster.races.length; raceIndex < racesLen; raceIndex++) {
            text += "<div>" + monster.races[raceIndex] + "</div>";
        }
        text += '</div>';
        text += '</div>';
    }
        
    $('<div id="showMonsterListDialog" title="Monster List">' + 
        '<div class="table items monsters">' + text + '</div>' +
      '</div>' ).dialog({
        modal: true,
        position: { my: 'top', at: 'top+150', of: $("body") },
        width: 800
    });
}

function selectMonster(monsterIndex) {
    var monster = bestiary.monsters[monsterIndex];
    $("#monsterDef").val(monster.def);
    $("#monsterSpr").val(monster.spr);
    for(var elementIndex = elementList.length; elementIndex--;) {
        var element = elementList[elementIndex];
        $("#elementalResists td." + element + " input").val("");
    }
    if (monster.resist) {
        for(var resistIndex = monster.resist.length; resistIndex--;) {
            var resist = monster.resist[resistIndex];
            $("#elementalResists td." + resist.name + " input").val(resist.percent);
        }   
    }
    unselectAll("races");
    select("races", monster.races);
    $('#showMonsterListDialog').dialog('destroy');
    if (builds[currentUnitIndex] && builds[currentUnitIndex].unit) {
        logCurrentBuild();    
    }
}

function removeItemFromExcludeList(id) {
    $("#showExcludedItemsDialog .tr.id_" + id).remove();
    itemsToExclude.splice(itemsToExclude.indexOf(id),1);
    $(".excludedItemNumber").html(itemsToExclude.length);
}

function resetExcludeList() {
    itemsToExclude = defaultItemsToExclude.slice();
    $('#showExcludedItemsDialog').dialog('destroy');
    showExcludedItems();
}

function getItemLineAsText(prefix, slot) {
    var item = builds[currentUnitIndex].build[slot];
    if (item) {
        var resultText = prefix + ": " + item.name + " ";
        var first = true;
        for (var statIndex = 0, len = baseStats.length; statIndex < len; statIndex++) {
            if (item[baseStats[statIndex]]) {
                if (first) {
                    first = false;
                } else {
                    resultText += ", ";
                }
                resultText += baseStats[statIndex].toUpperCase() + "+" + item[baseStats[statIndex]];
            }
            if (item[baseStats[statIndex] + "%"]) {
                if (first) {
                    first = false;
                } else {
                    resultText += ", ";
                }
                resultText += baseStats[statIndex].toUpperCase() + "+" + item[baseStats[statIndex]+"%"] + "%";
            }
        }
        return resultText + "  \n";
    } else {
        return "";
    }
}

function getBuildStatsAsText() {
    var resultText = "Total: ";
    var first = true;
    for (var statIndex = 0, len = baseStats.length; statIndex < len; statIndex++) {
        var result = calculateStatValue(builds[currentUnitIndex].build, baseStats[statIndex], builds[currentUnitIndex]).total;
        if (first) {
            first = false;
        } else {
            resultText += ", ";
        }
        resultText += baseStats[statIndex].toUpperCase() + ":" + Math.floor(result);
    }
    return resultText;
}

function onPotsChange(stat) {
    if (builds[currentUnitIndex].unit) {
        var value = parseInt($(".unitStats .stat." + stat + " .pots input").val()) || 0;
        if (value > builds[currentUnitIndex].unit.stats.pots[stat]) {
            $(".unitStats .stat." + stat + " .pots input").val(builds[currentUnitIndex].unit.stats.pots[stat]);
        }
        logCurrentBuild();
    }
}

function onBuffChange(stat) {
    if (builds[currentUnitIndex].unit) {
        var value = parseInt($(".unitStats .stat." + stat + " .buff input").val()) || 0;
        if (value > 600) {
            $(".unitStats .stat." + stat + " .buff input").val(600);
        }
        logCurrentBuild();
    }
}

function updateEspers() {
    
    var esperSource = espers;
    var equipments = $(".equipments select").val();
    if (equipments == "owned" && ownedEspers && Object.keys(ownedEspers).length > 0) {
        esperSource = [];
        for (var index in ownedEspers) {
            esperSource.push(getEsperItem(ownedEspers[index]));
        }
    }
    espersByName = {};
    for (var index = esperSource.length; index--;) {
        espersByName[esperSource[index].id] = esperSource[index];    
    }
    searchableEspers = [];
    for (var index = esperSource.length; index--;) {
        searchableEspers.push(esperSource[index]);
    }
    
    prepareSearch(searchableEspers);
}

$(function() {
    progressElement = $("#buildProgressBar .progressBar");
    $.get(getLocalizedFileUrl("data"), function(result) {
        data = result;
        dataStorage = new DataStorage(data);
        $.get(getLocalizedFileUrl("unitsWithSkill"), function(result) {
            units = result;
            populateUnitSelect();
            prepareSearch(data);
            continueIfReady();
        }, 'json').fail(function(jqXHR, textStatus, errorThrown ) {
            alert( errorThrown );
        });
    }, 'json').fail(function(jqXHR, textStatus, errorThrown ) {
        alert( errorThrown );
    });
    
    $.get(server + "/espers.json", function(result) {
        espers = [];
        for (var index = result.length; index--;) {
            espers.push(getEsperItem(result[index]))
        }
        updateEspers();
        
        continueIfReady();
    }, 'json').fail(function(jqXHR, textStatus, errorThrown ) {
        alert( errorThrown );
    });
    $.get(server + "/units", function(result) {
        ownedUnits = result;
        onEquipmentsChange();
    }, 'json').fail(function(jqXHR, textStatus, errorThrown ) {
    });
    $.get(server + "/monsters.json", function(result) {
        bestiary = new Bestiary(result);
        $("#monsterListLink").removeClass("hidden");
    }, 'json').fail(function(jqXHR, textStatus, errorThrown ) {
    });
    
    builds[currentUnitIndex] = {};
    
    $(".goal select").change(onGoalChange);
    
    $(".equipments select").change(onEquipmentsChange);
    
    $("#buildButton").click(build);
    
    
    
    // Elements
	addImageChoicesTo("elements",["fire", "ice", "lightning", "water", "wind", "earth", "light", "dark"]);
    // Killers
	addTextChoicesTo("races",'checkbox',{'Aquatic':'aquatic', 'Beast':'beast', 'Bird':'bird', 'Bug':'bug', 'Demon':'demon', 'Dragon':'dragon', 'Human':'human', 'Machine':'machine', 'Plant':'plant', 'Undead':'undead', 'Stone':'stone', 'Spirit':'spirit'});
    
    populateItemStat();
    populateUnitEquip();
    populateResists();
    
    // Triggers on search text box change
    $("#searchText").on("input", $.debounce(300,updateSearchResult));
    $('#fixItemModal').on('shown.bs.modal', function () {
        $('#searchText').focus();
    })  
    $("#customFormulaModal").on('shown.bs.modal', function () {
        $("#customFormulaModal input").focus();
    })
    
    
    $(".excludedItemNumber").html(itemsToExclude.length);

    $("#forceDoublehand input").change(function() {
        if ($("#forceDoublehand input").prop('checked')) {
            $('#forceDualWield input').prop('checked', false);
        }
    });
    $("#forceDualWield input").change(function() {
        if ($("#forceDualWield input").prop('checked')) {
            $('#forceDoublehand input').prop('checked', false);
        }
    });
    for (let statIndex = baseStats.length; statIndex--;) {
        $(".unitStats .stat." + baseStats[statIndex] + " .pots input").on('input',$.debounce(300,function() {onPotsChange(baseStats[statIndex]);}));
        $(".unitStats .stat." + baseStats[statIndex] + " .buff input").on('input',$.debounce(300,function() {onBuffChange(baseStats[statIndex]);}));
        $(".unitStats .stat." + baseStats[statIndex] + " .pots .leftIcon").click(function(stat) {
            if (builds[currentUnitIndex].unit) {
                var value = parseInt($(".unitStats .stat." + baseStats[statIndex] + " .pots input").val()) || 0;
                if (value == builds[currentUnitIndex].unit.stats.pots[baseStats[statIndex]]) {
                    $(".unitStats .stat." + baseStats[statIndex] + " .pots input").val("0");
                } else {
                    $(".unitStats .stat." + baseStats[statIndex] + " .pots input").val(builds[currentUnitIndex].unit.stats.pots[baseStats[statIndex]]);
                }
            }
        });
    }
    $(".unitStats .stat.lbFillRate .buff input").on('input',$.debounce(300,function() {onBuffChange("lbFillRate");}));
    $(".unitStats .stat.lbShardsPerTurn .buff input").on('input',$.debounce(300,function() {onBuffChange("lbFillRate")}));
});

var counter = 0;
function continueIfReady() {
    counter++;
    if (counter == 2) {
        initWorkerNumber();
        initWorkers();
        
        var hashData = readStateHashData();
        if (hashData) {
            loadStateHashAndBuild(hashData);
        } else {
            reinitBuild(currentUnitIndex);
        }
    }
}

function initWorkerNumber() {
    if (navigator.hardwareConcurrency) {
        numberOfWorkers = navigator.hardwareConcurrency;
    } else {
        console.log("No navigator.hardwareConcurrency support. Suppose 4 cores");
        numberOfWorkers = 4;
    }
    $("#coreUsage input").val(numberOfWorkers);
    $("#coreUsage input").on('input',$.debounce(300,function() {
        var number = parseInt($("#coreUsage input").val());
        if (!number || isNaN(number) || number < 1) {
            $("#coreUsage input").val("1");
            numberOfWorkers = 1;
        } else {
            numberOfWorkers = number;
        }
        initWorkers();
    }));
}

function initWorkers() {
    workers = [];
    for (var index = 0, len = numberOfWorkers; index < len; index++) {
        workers.push(new Worker('builder/optimizerWebWorker.js'));
        workers[index].postMessage(JSON.stringify({"type":"init", "allItemVersions":dataStorage.itemWithVariation, "number":index}));
        workers[index].onmessage = function(event) {
            var messageData = JSON.parse(event.data);
            switch(messageData.type) {
                case "betterBuildFound":
                    if (!builds[currentUnitIndex].buildValue || builds[currentUnitIndex].buildValue < messageData.value) {
                        builds[currentUnitIndex].build = messageData.build;
                        builds[currentUnitIndex].buildValue = messageData.value;
                        logCurrentBuild();
                    }
                    break;
                case "finished":
                    workerWorkingCount--;
                    processTypeCombinations(messageData.number);
                    processedCount = Math.min(processedCount + typeCombinationChunckSize, typeCombinationsCount);
                    var newProgress = Math.floor(processedCount/typeCombinationsCount*100);
                    if (progress != newProgress) {
                        progress = newProgress;
                        progressElement.width(progress + "%");
                        progressElement.text(progress + "%");    
                    }
                    if (workerWorkingCount == 0) {
                        progressElement.addClass("finished");
                        console.timeEnd("optimize");
                        if (!builds[currentUnitIndex].buildValue && builds[currentUnitIndex].formula.conditions) {
                            alert("The condition set in the goal are impossible to meet.");
                        }
                        running = false;
                        $("#buildButton").text("Build !");
                    }
                    break;
            }
        }
    }
}

function populateUnitEquip() {
    var target = $(".unitEquipable.weapons1");
    var counter = 0;
    target.html("");
	for (var key in weaponList) {
        counter++;
        if(counter == 9) {
            var target = $(".unitEquipable.weapons2");
            target.html("");
        }
        target.append('<img src="img/' + weaponList[key] + '.png" class="notEquipable ' + weaponList[key] +'"/>');
	}
    var target = $(".unitEquipable.armors");
    target.html("");
    for (var key in shieldList) {
        target.append('<img src="img/' + shieldList[key] + '.png" class="notEquipable ' + shieldList[key] +'"/>');
	}
    for (var key in headList) {
        target.append('<img src="img/' + headList[key] + '.png" class="notEquipable ' + headList[key] +'"/>');
	}
    for (var key in bodyList) {
        target.append('<img src="img/' + bodyList[key] + '.png" class="notEquipable ' + bodyList[key] +'"/>');
	}
}
    
function populateItemType(equip) {
    var target = $("#fixItemModal .modal-body .nav.type");
    target.html("");
    if (equip.length > 1) {
        target.append("<li class='all'><a onclick='selectSearchType(" + JSON.stringify(equip) + ");updateSearchResult();'><img src='img/all.png'/></a></li>");
    }
	for (var key in equip) {
        target.append('<li class="' + equip[key] + '"><a onclick="selectSearchType([\'' + equip[key] + '\']);updateSearchResult();"><img src="img/' + equip[key] + '.png"/></a></li>');
	}
    
}

function populateItemStat() {
    var statList = ["hp", "mp", "atk", "def", "mag", "spr", "evade", "inflict", "resist"];
    var target = $("#fixItemModal .stat .dropdown-menu");
    target.append('<img src="img/sort-a-z.png" onclick="selectSearchStat();updateSearchResult();" class="btn btn-default"/>');
	for (var key in statList) {
        target.append('<img src="img/sort-' + statList[key] + '.png" onclick="selectSearchStat(\'' + statList[key] + '\');updateSearchResult();" class="btn btn-default"/>');
	}
}

function populateResists() {
    var div = $("#resultStats .resists .elements");
    for (var index in elementList) {
        div.append('<div class="resist ' + elementList[index] + ' ' +  escapeDot("resist|" + elementList[index] + ".percent") + '"><img src="img/' + elementList[index] + '.png"><div class="value">0%<div></div>');
    }
    var div = $("#resultStats .resists .ailments");
    for (var index in ailmentList) {
        div.append('<div class="resist ' + ailmentList[index] + ' ' +  escapeDot("resist|" + ailmentList[index] + ".percent") +'"><img src="img/' + ailmentList[index] + '.png"><div class="value">0%<div></div>');
    }
}