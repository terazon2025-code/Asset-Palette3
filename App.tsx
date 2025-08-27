
import React, { useState, useCallback } from 'react';
import { PortfolioData, Holding, NamedPortfolioData, AggregatedHolding, GroupedData } from './types';
import FileUpload from './components/FileUpload';
import Dashboard from './components/Dashboard';

const assetTypeOrder: { [key: string]: number } = {
  '国内株式': 1, '米国株式': 2, '中国株式': 3, 'アセアン株式': 4,
  '投資信託': 5, '金・プラチナ': 6, '国内債券': 7, '外国債券': 8,
  '現金': 98, '仮想通貨': 99,
};

const aggregateHoldingsByName = (holdings: Holding[]): AggregatedHolding[] => {
  // First, group holdings by name and sum up total values.
  const holdingGroups = new Map<string, { totalValue: number, totalGainLoss: number, type: string, subHoldings: Holding[] }>();
  for (const holding of holdings) {
      if (!holdingGroups.has(holding.name)) {
          holdingGroups.set(holding.name, {
              totalValue: 0,
              totalGainLoss: 0,
              type: holding.type,
              subHoldings: []
          });
      }
      const group = holdingGroups.get(holding.name)!;
      group.totalValue += holding.value;
      group.totalGainLoss += holding.gainLoss;
      group.subHoldings.push(holding);
  }
  
  const aggregatedResult: AggregatedHolding[] = [];
  // For each name group, aggregate its sub-holdings by account type.
  for(const [name, group] of holdingGroups.entries()) {
    const subHoldingsByAccount = new Map<string, { value: number; gainLoss: number; originalHoldings: Holding[] }>();
    for (const subHolding of group.subHoldings) {
      if (!subHoldingsByAccount.has(subHolding.account)) {
        subHoldingsByAccount.set(subHolding.account, { value: 0, gainLoss: 0, originalHoldings: [] });
      }
      const accountGroup = subHoldingsByAccount.get(subHolding.account)!;
      accountGroup.value += subHolding.value;
      accountGroup.gainLoss += subHolding.gainLoss;
      accountGroup.originalHoldings.push(subHolding);
    }

    // Create the final list of sub-holdings, merged by account.
    const newSubHoldings: Holding[] = Array.from(subHoldingsByAccount.entries()).map(([account, data]) => {
      // If only one original holding exists for this account, use it directly to preserve its ID for editing.
      if (data.originalHoldings.length === 1) {
        return data.originalHoldings[0];
      } else {
        // If multiple holdings were merged, create a new synthetic holding object.
        // Editing won't be possible for this merged entry, which is acceptable.
        return {
          id: `aggregated_${name}_${account}`,
          type: group.type,
          name: name,
          account: account,
          value: data.value,
          gainLoss: data.gainLoss,
        };
      }
    });

    aggregatedResult.push({
      name,
      type: group.type,
      totalValue: group.totalValue,
      totalGainLoss: group.totalGainLoss,
      subHoldings: newSubHoldings.sort((a, b) => b.value - a.value),
    });
  }

  return aggregatedResult.sort((a, b) => {
    const typeOrderA = assetTypeOrder[a.type] || 90;
    const typeOrderB = assetTypeOrder[b.type] || 90;
    if (typeOrderA !== typeOrderB) {
      return typeOrderA - typeOrderB;
    }
    return b.totalValue - a.totalValue;
  });
};


const recalculatePortfolio = (allHoldings: Holding[]): PortfolioData => {
  const totalValue = allHoldings.reduce((sum, h) => sum + h.value, 0);
  const totalGainLoss = allHoldings.reduce((sum, h) => sum + h.gainLoss, 0);

  const aggregatedHoldings = aggregateHoldingsByName(allHoldings);
  
  // byAssetClass
  const assetClassGroups = new Map<string, Holding[]>();
  allHoldings.forEach(h => {
    if (!assetClassGroups.has(h.type)) assetClassGroups.set(h.type, []);
    assetClassGroups.get(h.type)!.push(h);
  });
  const byAssetClass: GroupedData[] = Array.from(assetClassGroups.entries()).map(([name, holdings]) => {
    const value = holdings.reduce((sum, h) => sum + h.value, 0);
    const gainLoss = holdings.reduce((sum, h) => sum + h.gainLoss, 0);
    return {
      name,
      value,
      gainLoss,
      aggregatedHoldings: aggregateHoldingsByName(holdings)
    };
  }).sort((a,b) => b.value - a.value);

  // byAccount
  const accountGroups = new Map<string, Holding[]>();
  allHoldings.forEach(h => {
    const key = h.account === '手入力' ? h.type : h.account;
    if (!accountGroups.has(key)) accountGroups.set(key, []);
    accountGroups.get(key)!.push(h);
  });
  const byAccount: GroupedData[] = Array.from(accountGroups.entries()).map(([name, holdings]) => {
    const value = holdings.reduce((sum, h) => sum + h.value, 0);
    const gainLoss = holdings.reduce((sum, h) => sum + h.gainLoss, 0);
    return {
      name,
      value,
      gainLoss,
      aggregatedHoldings: aggregateHoldingsByName(holdings)
    };
  }).sort((a,b) => b.value - a.value);

  const byHoldingForPie = aggregatedHoldings.map(h => ({ name: h.name, value: h.totalValue, type: h.type })).sort((a, b) => b.value - a.value);

  return { totalValue, totalGainLoss, aggregatedHoldings, byAccount, byAssetClass, byHoldingForPie, holdings: allHoldings };
};

interface AppState {
  individual: NamedPortfolioData[];
  combined: PortfolioData;
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState | null>(null);

  const handleDataLoaded = useCallback((portfolios: NamedPortfolioData[]) => {
    const allHoldings = portfolios.flatMap(p => p.data.holdings);
    const combinedData = recalculatePortfolio(allHoldings);
    setAppState({ individual: portfolios, combined: combinedData });
  }, []);

  const handleReset = useCallback(() => {
    setAppState(null);
  }, []);

  const handleManualAdd = useCallback((portfolioIndex: number, newAssetData: Omit<Holding, 'id' | 'account'>) => {
    setAppState(prevState => {
      if (!prevState) return null;
      const newAsset: Holding = {
        ...newAssetData,
        id: `manual_${Date.now()}`,
        account: '手入力',
      };
      
      const updatedIndividual = [...prevState.individual];
      const targetPortfolio = updatedIndividual[portfolioIndex];
      const updatedHoldings = [...targetPortfolio.data.holdings, newAsset];
      updatedIndividual[portfolioIndex] = {
        ...targetPortfolio,
        data: recalculatePortfolio(updatedHoldings),
      };
      
      const allHoldings = updatedIndividual.flatMap(p => p.data.holdings);
      const combinedData = recalculatePortfolio(allHoldings);
      return { individual: updatedIndividual, combined: combinedData };
    });
  }, []);

  const handleUpdateAsset = useCallback((portfolioIndex: number, updatedAsset: Holding) => {
    setAppState(prevState => {
      if (!prevState) return null;
      const updatedIndividual = [...prevState.individual];
      const targetPortfolio = updatedIndividual[portfolioIndex];
      const updatedHoldings = targetPortfolio.data.holdings.map(h => h.id === updatedAsset.id ? updatedAsset : h);
      updatedIndividual[portfolioIndex] = {
        ...targetPortfolio,
        data: recalculatePortfolio(updatedHoldings),
      };
      
      const allHoldings = updatedIndividual.flatMap(p => p.data.holdings);
      const combinedData = recalculatePortfolio(allHoldings);
      return { individual: updatedIndividual, combined: combinedData };
    });
  }, []);

  const handleDeleteAsset = useCallback((portfolioIndex: number, assetId: string) => {
    setAppState(prevState => {
      if (!prevState) return null;
      const updatedIndividual = [...prevState.individual];
      const targetPortfolio = updatedIndividual[portfolioIndex];
      const updatedHoldings = targetPortfolio.data.holdings.filter(h => h.id !== assetId);
      updatedIndividual[portfolioIndex] = {
        ...targetPortfolio,
        data: recalculatePortfolio(updatedHoldings),
      };
      
      const allHoldings = updatedIndividual.flatMap(p => p.data.holdings);
      const combinedData = recalculatePortfolio(allHoldings);
      return { individual: updatedIndividual, combined: combinedData };
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {!appState ? (
        <FileUpload onDataLoaded={handleDataLoaded} />
      ) : (
        <Dashboard 
          individualPortfolios={appState.individual}
          combinedPortfolio={appState.combined}
          onReset={handleReset} 
          onManualAdd={handleManualAdd}
          onUpdateAsset={handleUpdateAsset}
          onDeleteAsset={handleDeleteAsset}
        />
      )}
    </div>
  );
};

export default App;
